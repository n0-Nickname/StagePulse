import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import {
  createSpeechStore,
  useWpmMetrics,
  usePauseMetrics,
  useFillerMetrics,
  useTranscriptState,
  useTranscriptTail,
  useSessionStatus,
  buildCommittedBlocks,
  computePartialText,
  detectWasmMode,
  normalizeFillerWords,
  buildFillerRegex,
  segmentTextByFillers,
  COMMITTED_BLOCK_WORD_SIZE,
} from './speechStore.js';

describe('speechStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes granular useSyncExternalStore slices and skips re-renders on unrelated updates', () => {
    const store = createSpeechStore();
    let wpmRenders = 0;
    let pauseRenders = 0;
    let fillerRenders = 0;
    let tailRenders = 0;
    let statusRenders = 0;

    function WpmReader() {
      wpmRenders += 1;
      const { wpm, rollingWpm, wordCount } = useWpmMetrics(store);
      return <div data-testid="wpm">{`${wpm}-${rollingWpm}-${wordCount}`}</div>;
    }
    function PauseReader() {
      pauseRenders += 1;
      const { longPausesCount, activePauseMs, isPausedLive } = usePauseMetrics(store);
      return <div data-testid="pause">{`${longPausesCount}-${activePauseMs}-${isPausedLive}`}</div>;
    }
    function FillerReader() {
      fillerRenders += 1;
      const { isPro, userFillerWords, fillerCount, fillerWords } = useFillerMetrics(store);
      return (
        <div data-testid="filler">
          {`${isPro}-${userFillerWords.length}-${fillerCount}-${Object.keys(fillerWords).length}`}
        </div>
      );
    }
    function TailReader() {
      tailRenders += 1;
      const { partialText, fullText } = useTranscriptTail(store);
      return <div data-testid="tail">{`${partialText}|${fullText}`}</div>;
    }
    function StatusReader() {
      statusRenders += 1;
      const { isRecording, isWarmingUp, wasmMode, activeLang, error } = useSessionStatus(store);
      return (
        <div data-testid="status">
          {`${isRecording}-${isWarmingUp}-${wasmMode}-${activeLang}-${error ?? 'none'}`}
        </div>
      );
    }

    render(
      <>
        <WpmReader />
        <PauseReader />
        <FillerReader />
        <TailReader />
        <StatusReader />
      </>
    );

    expect(wpmRenders).toBe(1);
    expect(pauseRenders).toBe(1);
    expect(fillerRenders).toBe(1);
    expect(tailRenders).toBe(1);
    expect(statusRenders).toBe(1);

    // Partial transcript update -> ONLY TailReader re-renders
    act(() => {
      store.patch({ partialText: 'hello world', fullText: 'hello world' });
    });
    expect(screen.getByTestId('tail')).toHaveTextContent('hello world|hello world');
    expect(tailRenders).toBe(2);
    expect(wpmRenders).toBe(1);
    expect(pauseRenders).toBe(1);
    expect(fillerRenders).toBe(1);
    expect(statusRenders).toBe(1);

    // Same WPM values -> WpmReader does not re-render
    act(() => {
      store.patch({ wpm: 0, rollingWpm: 0, wordCount: 0 });
    });
    expect(wpmRenders).toBe(1);

    // WPM change -> ONLY WpmReader re-renders
    act(() => {
      store.patch({ wpm: 132, rollingWpm: 140, wordCount: 44, pacingZone: 'optimal' });
    });
    expect(screen.getByTestId('wpm')).toHaveTextContent('132-140-44');
    expect(wpmRenders).toBe(2);
    expect(pauseRenders).toBe(1);
    expect(fillerRenders).toBe(1);

    // Pause change -> ONLY PauseReader re-renders
    act(() => {
      store.patch({
        longPausesCount: 2,
        activePauseMs: 1800,
        isPausedLive: true,
        totalPauseSec: 3.6,
        currentSilenceSec: 1.8,
      });
    });
    expect(screen.getByTestId('pause')).toHaveTextContent('2-1800-true');
    expect(pauseRenders).toBe(2);
    expect(wpmRenders).toBe(2);

    // Non-PRO suppresses fillerCount/fillerBreakdown even if patched
    act(() => {
      store.patch({ fillerCount: 5, fillerBreakdown: { like: 5 } });
    });
    expect(screen.getByTestId('filler')).toHaveTextContent('false-0-0-0');
    expect(fillerRenders).toBe(1);

    // PRO + custom dictionary + filler change -> ONLY FillerReader re-renders
    act(() => {
      store.patch({
        isPro: true,
        userFillerWords: ['like'],
        fillerCount: 2,
        fillerBreakdown: { like: 2 },
      });
    });
    expect(screen.getByTestId('filler')).toHaveTextContent('true-1-2-1');
    expect(fillerRenders).toBe(2);

    // Status change -> ONLY StatusReader re-renders
    act(() => {
      store.patch({
        isRecording: true,
        isWarmingUp: false,
        wasmMode: 'MT-WASM',
        activeLang: 'en-US',
        engineError: 'oops',
      });
    });
    expect(screen.getByTestId('status')).toHaveTextContent('true-false-MT-WASM-en-US-oops');
    expect(statusRenders).toBe(2);

    const { result } = renderHook(() => useTranscriptState(store));
    expect(result.current.fullText).toBe('hello world');

    act(() => {
      store.reset();
    });
    expect(result.current.committedBlocks).toEqual([]);
    expect(result.current.partialText).toBe('');
  });

  it('builds append-only committedBlocks and preserves completed block references for 1500+ words', () => {
    const firstBatch = Array.from({ length: 120 }, (_, i) => ({
      text: `word${i}`,
      startMs: i * 300,
      endMs: i * 300 + 200,
      join: false,
    }));
    const blocks1 = buildCommittedBlocks(firstBatch, []);
    expect(blocks1).toHaveLength(2);
    expect(blocks1[0].words).toHaveLength(COMMITTED_BLOCK_WORD_SIZE);
    expect(blocks1[1].words).toHaveLength(COMMITTED_BLOCK_WORD_SIZE);

    // Appending 1,440 more words (total 1,560 words) preserves exact references of blocks 0 and 1
    const bigBatch = Array.from({ length: 1560 }, (_, i) => ({
      text: i % 100 === 0 ? 'like' : `w${i}`,
      startMs: i * 250,
      endMs: i * 250 + 180,
      join: false,
    }));
    // Keep same prefix so blocks 0 and 1 match
    for (let i = 0; i < 120; i += 1) {
      bigBatch[i] = firstBatch[i];
    }
    const blocks2 = buildCommittedBlocks(bigBatch, blocks1);
    expect(blocks2.length).toBeGreaterThanOrEqual(26);
    expect(blocks2[0]).toBe(blocks1[0]);
    expect(blocks2[1]).toBe(blocks1[1]);
    expect(buildCommittedBlocks([], blocks2)).toEqual([]);
  });

  it('computes partialText from committed words + fullText and detects MT-WASM vs ST-WASM', () => {
    const words = [
      { text: 'Hello', join: false },
      { text: ',', join: true },
      { text: 'world', join: false },
    ];
    expect(computePartialText(words, 'Hello, world')).toEqual({
      committedText: 'Hello, world',
      partialText: '',
    });
    expect(computePartialText(words, 'Hello, world next hypothesis')).toEqual({
      committedText: 'Hello, world',
      partialText: 'next hypothesis',
    });
    expect(computePartialText([], 'streaming partial')).toEqual({
      committedText: '',
      partialText: 'streaming partial',
    });
    expect(computePartialText(words, '')).toEqual({
      committedText: 'Hello, world',
      partialText: '',
    });
    expect(computePartialText([{ text: '' }, { text: 'abc' }], 'different')).toEqual({
      committedText: 'abc',
      partialText: '',
    });
    const edgeStore = createSpeechStore();
    edgeStore.patch(null);

    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('SharedArrayBuffer', function SharedArrayBufferStub() {});
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    expect(detectWasmMode()).toBe('MT-WASM');

    vi.stubGlobal('crossOriginIsolated', false);
    expect(detectWasmMode()).toBe('ST-WASM');
  });

  it('normalizes filler words, builds longest-first Unicode regex, and segments text strictly by isPro', () => {
    expect(normalizeFillerWords(null)).toEqual([]);
    expect(normalizeFillerWords(['  Like ', 'like', '', 42, '  як   би '])).toEqual([
      'like',
      'як би',
    ]);

    expect(buildFillerRegex([]).regex).toBeNull();
    expect(segmentTextByFillers('', ['like'], true)).toEqual([]);
    expect(segmentTextByFillers('Ну типу like', ['ну', 'like'], false)).toEqual([
      { text: 'Ну типу like', isFiller: false },
    ]);
    expect(segmentTextByFillers('Hello world', [], true)).toEqual([
      { text: 'Hello world', isFiller: false },
    ]);

    // Longest-first phrase match ('як би' beats 'як') + whole-word boundary check ('подібний' != 'діб')
    expect(segmentTextByFillers('Це, як би, подібний приклад і як так', ['як', 'як би', 'діб'], true)).toEqual([
      { text: 'Це, ', isFiller: false },
      { text: 'як би', isFiller: true },
      { text: ', подібний приклад і ', isFiller: false },
      { text: 'як', isFiller: true },
      { text: ' так', isFiller: false },
    ]);
  });
});
