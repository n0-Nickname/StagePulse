import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useSpeechAnalytics,
  computeWordTimestampPauses,
  computeOverallWpm,
  analyzeFillers,
} from './useSpeechAnalytics.js';

describe('speech analytics helpers', () => {
  it('computes inter-word timestamp pauses and trailing silence >= 1500ms', () => {
    expect(computeWordTimestampPauses([], 5000)).toEqual({
      pauseCount: 0,
      totalPauseSec: 0,
      isSilentPause: false,
      currentSilenceSec: 0,
    });

    const words = [
      { text: 'Hello', startMs: 200, endMs: 600 },
      { text: 'world', startMs: 2400, endMs: 2900 }, // 1800ms gap >= 1500ms
      { text: 'today', startMs: 3100, endMs: 3500 }, // 200ms gap < 1500ms
    ];

    // At 4000ms: trailing silence is 500ms (<1500ms)
    expect(computeWordTimestampPauses(words, 4000)).toEqual({
      pauseCount: 1,
      totalPauseSec: 1.8,
      isSilentPause: false,
      currentSilenceSec: 0.5,
    });

    // At 5500ms: trailing silence is 2000ms (>=1500ms)
    expect(computeWordTimestampPauses(words, 5500)).toEqual({
      pauseCount: 2,
      totalPauseSec: 3.8,
      isSilentPause: true,
      currentSilenceSec: 2.0,
    });
  });

  it('computes overall WPM with 5-second warmup threshold and bilingual fillers', () => {
    expect(computeOverallWpm(10, 4)).toBe(0);
    expect(computeOverallWpm(0, 10)).toBe(0);
    expect(computeOverallWpm(15, 6)).toBe(150);

    expect(analyzeFillers('', 'en-US')).toEqual({ fillerCount: 0, fillerBreakdown: {} });
    expect(analyzeFillers('So basically like um hello', 'en-US')).toEqual({
      fillerCount: 4,
      fillerBreakdown: { so: 1, basically: 1, like: 1, um: 1 },
    });
    expect(analyzeFillers('Ну типу короче блін як би власне значить от', 'uk-UA')).toEqual({
      fillerCount: 8,
      fillerBreakdown: {
        ну: 1,
        типу: 1,
        короче: 1,
        блін: 1,
        'як би': 1,
        власне: 1,
        значить: 1,
        от: 1,
      },
    });
  });
});

describe('useSpeechAnalytics', () => {
  let rafCallbacks = [];
  let rafIdCounter = 1;

  beforeEach(() => {
    rafCallbacks = [];
    rafIdCounter = 1;
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      const id = rafIdCounter++;
      rafCallbacks.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id) => {
      rafCallbacks = rafCallbacks.filter((item) => item.id !== id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete globalThis.Worker;
  });

  const flushRafFrame = async (nowMs) => {
    const batch = [...rafCallbacks];
    rafCallbacks = [];
    await act(async () => {
      for (const item of batch) {
        item.cb(nowMs);
      }
    });
  };

  it('streams audio to injectable AsrEngineAdapter, computes timestamp pauses, WPM, and model progress', async () => {
    let callbacks = null;
    const pushAudio = vi.fn();
    const destroy = vi.fn();
    const stopCapture = vi.fn();
    let captureCallbacks = null;

    const engineFactory = () => ({
      init: vi.fn(async (opts) => {
        callbacks = opts;
        opts.onProgress?.({ percent: 45, cached: false });
        opts.onProgress?.({ percent: 100, cached: true });
      }),
      pushAudio,
      destroy,
    });

    const micCaptureFactory = vi.fn(async (opts) => {
      captureCallbacks = opts;
      return { stop: stopCapture };
    });

    const { result, rerender, unmount } = renderHook(
      ({ running, elapsed, lang }) =>
        useSpeechAnalytics(running, elapsed, lang, { engineFactory, micCaptureFactory }),
      { initialProps: { running: true, elapsed: 6, lang: 'en-US' } }
    );

    await waitFor(() => expect(captureCallbacks).not.toBeNull());
    expect(result.current.modelProgress).toEqual({ percent: 100, cached: true, ready: true });

    // Stream mic chunk & RMS
    act(() => {
      const chunk = new Float32Array([0.05, -0.05]);
      captureCallbacks.onRms(0.08);
      captureCallbacks.onChunk(chunk);
    });
    expect(pushAudio).toHaveBeenCalledTimes(1);
    expect(result.current.rmsLevel).toBeGreaterThan(0);

    // Emit timestamped words with a 1.8s pause between words
    act(() => {
      callbacks.onTranscript({
        words: [
          { text: 'Hello', startMs: 200, endMs: 700 },
          { text: 'like', startMs: 2500, endMs: 2900 },
          { text: 'world', startMs: 3000, endMs: 3400 },
        ],
        fullText: 'Hello like world',
        isFinal: true,
      });
    });

    expect(result.current.wordCount).toBe(3);
    expect(result.current.fillerCount).toBe(1);
    expect(result.current.wpm).toBe(30); // 3 words / (6/60 min) = 30 wpm

    // Elapsed = 6s => 6000ms - 3400ms = 2600ms trailing silence + 1800ms internal gap => 2 pauses
    expect(result.current.pauseCount).toBe(2);
    expect(result.current.isSilentPause).toBe(true);
    expect(result.current.totalPauseSec).toBe(4.4);

    // Empty transcript payload resets words safely
    act(() => {
      callbacks.onTranscript({ words: null, fullText: '' });
    });
    expect(result.current.wordCount).toBe(0);

    await act(async () => {
      rerender({ running: false, elapsed: 6, lang: 'en-US' });
    });
    expect(stopCapture).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    unmount();
  });

  it('handles WASM engine init failure (mic permission error vs fallback to Web Speech) and cancellation during init', async () => {
    // 1. Mic permission error inside WASM pipeline switches to simulated mic
    const permEngineFactory = () => ({
      init: vi.fn().mockRejectedValue(new Error('Permission denied')),
      destroy: vi.fn(),
    });
    const { result: r1 } = renderHook(() =>
      useSpeechAnalytics(true, 0, 'uk-UA', { engineFactory: permEngineFactory })
    );
    await waitFor(() => expect(r1.current.isSimulatedMic).toBe(true));
    expect(r1.current.micError).toBe('Permission denied');

    // 2. Non-mic WASM failure falls through to Web Speech / Audio Burst
    const wasmFailFactory = () => ({
      init: vi.fn().mockRejectedValue(new Error('WASM decode error')),
      destroy: vi.fn(),
    });
    const { result: r2 } = renderHook(() =>
      useSpeechAnalytics(true, 0, 'uk-UA', { engineFactory: wasmFailFactory })
    );
    await waitFor(() => expect(r2.current.estimationMethod).toBe('audio_burst'));

    // 3. Cancellation right after adapter.init resolves & right after micCapture resolves
    let resolveInit;
    const destroySpy = vi.fn();
    const stopSpy = vi.fn();
    const lateEngineFactory = () => ({
      init: () =>
        new Promise((res) => {
          resolveInit = res;
        }),
      destroy: destroySpy,
    });

    const { rerender: rerenderLate } = renderHook(
      ({ running }) =>
        useSpeechAnalytics(running, 0, 'uk-UA', { engineFactory: lateEngineFactory }),
      { initialProps: { running: true } }
    );
    await act(async () => {
      rerenderLate({ running: false });
    });
    await act(async () => {
      resolveInit();
    });
    expect(destroySpy).toHaveBeenCalled();

    let resolveCap;
    const lateCapFactory = () =>
      new Promise((res) => {
        resolveCap = res;
      });
    const okEngineFactory = () => ({
      init: vi.fn().mockResolvedValue(undefined),
      destroy: destroySpy,
    });
    const { rerender: rerenderCap } = renderHook(
      ({ running }) =>
        useSpeechAnalytics(running, 0, 'uk-UA', {
          engineFactory: okEngineFactory,
          micCaptureFactory: lateCapFactory,
        }),
      { initialProps: { running: true } }
    );
    await act(async () => {
      rerenderCap({ running: false });
    });
    await act(async () => {
      resolveCap({ stop: stopSpy });
    });
    expect(stopSpy).toHaveBeenCalled();

    // 4. Late onProgress / onTranscript / Permission catch after cancellation + default Worker path
    let lateOpts = null;
    let rejectLateInit = null;
    const lateCancelledEngine = () => ({
      init: (opts) => {
        lateOpts = opts;
        return new Promise((_, rej) => {
          rejectLateInit = rej;
        });
      },
      destroy: destroySpy,
    });
    const { rerender: rerenderLateCb } = renderHook(
      ({ running }) =>
        useSpeechAnalytics(running, 0, 'uk-UA', { engineFactory: lateCancelledEngine }),
      { initialProps: { running: true } }
    );
    await act(async () => {
      rerenderLateCb({ running: false });
    });
    await act(async () => {
      lateOpts.onProgress({ percent: 50, cached: false });
      lateOpts.onTranscript({ words: [{ text: 'late', startMs: 0, endMs: 100 }], fullText: 'late' });
      rejectLateInit(new Error('Permission denied late'));
    });

    // 5. Default Worker path without engineFactory
    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.postMessage = () => {
          this.onmessage?.({ data: { type: 'ENGINE_ERROR', message: 'offline' } });
        };
        this.terminate = vi.fn();
      }
    };
    const { result: rWorker } = renderHook(() => useSpeechAnalytics(true, 0, 'en-US'));
    await waitFor(() => expect(rWorker.current.estimationMethod).toBe('audio_burst'));
  });

  it('uses Web Speech API when available, tracks transcripts, fillers, pacing timeline, and audio bursts', async () => {
    let lastRec = null;
    class MockSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = '';
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        lastRec = this;
      }
      start() {}
      abort() {}
    }
    window.SpeechRecognition = MockSpeechRecognition;

    const getFloat = vi.fn((arr) => arr.fill(0.08));
    const origCreateAnalyser = window.AudioContext.prototype.createAnalyser;
    window.AudioContext.prototype.createAnalyser = () => ({
      fftSize: 512,
      frequencyBinCount: 256,
      smoothingTimeConstant: 0.75,
      getFloatTimeDomainData: getFloat,
      getByteFrequencyData: vi.fn((arr) => arr.fill(120)),
    });

    const { result, rerender, unmount } = renderHook(
      ({ running, elapsed, lang }) => useSpeechAnalytics(running, elapsed, lang),
      { initialProps: { running: false, elapsed: 0, lang: 'en-US' } }
    );

    expect(result.current.wpm).toBe(0);
    expect(result.current.pacingZone).toBe('warming_up');

    await act(async () => {
      rerender({ running: true, elapsed: 0, lang: 'en-US' });
    });
    await waitFor(() => expect(lastRec).not.toBeNull());
    expect(lastRec.lang).toBe('en-US');

    await act(async () => {
      lastRec.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript: '   ' }], { isFinal: true })],
      });
      lastRec.onresult({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: '   ' }], { isFinal: true }),
          Object.assign([{ transcript: 'Hello everyone today' }], { isFinal: true }),
          Object.assign([{ transcript: 'we are speaking like um basically clearly now' }], { isFinal: false }),
        ],
      });
    });

    expect(result.current.wordCount).toBeGreaterThanOrEqual(11);
    expect(result.current.fillerCount).toBe(3);
    expect(result.current.fillerBreakdown).toMatchObject({ like: 1, um: 1, basically: 1 });

    await flushRafFrame(10);
    await flushRafFrame(100);
    await flushRafFrame(1200);

    getFloat.mockImplementation((arr) => arr.fill(0.005));
    await flushRafFrame(1300);
    getFloat.mockImplementation((arr) => arr.fill(0.4));
    await flushRafFrame(1500);

    getFloat.mockImplementation((arr) => arr.fill(0.002));
    await flushRafFrame(1600);
    await flushRafFrame(3200);
    await flushRafFrame(3400);

    expect(result.current.pauseCount).toBe(1);
    expect(result.current.isSilentPause).toBe(true);
    expect(result.current.totalPauseSec).toBeGreaterThan(1.5);

    getFloat.mockImplementation((arr) => arr.fill(0.4));
    await flushRafFrame(3500);
    expect(result.current.isSilentPause).toBe(false);

    await act(async () => {
      rerender({ running: true, elapsed: 10, lang: 'en-US' });
    });
    expect(result.current.pacingTimeline.length).toBe(1);
    expect(['too_slow', 'optimal', 'too_fast']).toContain(result.current.pacingZone);

    await act(async () => {
      lastRec.onend();
      lastRec.onerror({ error: '' });
      lastRec.onerror({ error: 'network' });
    });
    expect(result.current.estimationMethod).toBe('audio_burst');

    const staleBatch = [...rafCallbacks];
    await act(async () => {
      rerender({ running: false, elapsed: 10, lang: 'en-US' });
    });
    await act(async () => {
      for (const item of staleBatch) {
        item.cb(4000);
      }
    });

    await act(async () => {
      result.current.resetAnalytics();
    });
    expect(result.current.wordCount).toBe(0);
    expect(result.current.pauseCount).toBe(0);

    window.AudioContext.prototype.createAnalyser = origCreateAnalyser;
    unmount();
  });

  it('falls back to simulated mic when getUserMedia rejects or mediaDevices missing, and supports uk-UA fillers & webkitAudioContext', async () => {
    const origMediaDevices = navigator.mediaDevices;
    const origAC = window.AudioContext;
    delete window.AudioContext;
    let ukRec = null;
    window.SpeechRecognition = class {
      start() {
        ukRec = this;
      }
      abort() {}
    };

    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValueOnce(undefined);

    const { result, rerender, unmount } = renderHook(
      ({ running, elapsed, lang }) => useSpeechAnalytics(running, elapsed, lang),
      { initialProps: { running: true, elapsed: 15, lang: 'uk-UA' } }
    );

    await waitFor(() => expect(result.current.isSimulatedMic).toBe(true));
    expect(result.current.micError).toMatch(/Microphone unavailable/i);
    expect(result.current.estimationMethod).toBe('audio_burst');

    await flushRafFrame(100);
    await flushRafFrame(1300);
    await flushRafFrame(4000);
    await flushRafFrame(4500);

    await act(async () => {
      result.current.setIsSimulatingSilence(true);
    });
    await flushRafFrame(4600);
    await flushRafFrame(6300);
    expect(result.current.pauseCount).toBeGreaterThanOrEqual(1);

    await act(async () => {
      rerender({ running: false, elapsed: 15, lang: 'uk-UA' });
    });
    expect(result.current.isSilentPause).toBe(false);

    await act(async () => {
      result.current.setIsSimulatedMic(false);
      rerender({ running: true, elapsed: 20, lang: 'uk-UA' });
    });
    await waitFor(() => expect(ukRec).not.toBeNull());
    await act(async () => {
      ukRec.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript: 'Ну типу це власне тест' }], { isFinal: true })],
      });
    });
    expect(result.current.fillerCount).toBe(3);

    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
    });
    await act(async () => {
      rerender({ running: false, elapsed: 20, lang: 'uk-UA' });
    });
    await act(async () => {
      rerender({ running: true, elapsed: 20, lang: 'uk-UA' });
    });
    await waitFor(() => expect(result.current.isSimulatedMic).toBe(true));

    Object.defineProperty(navigator, 'mediaDevices', {
      value: origMediaDevices,
      configurable: true,
    });
    window.AudioContext = origAC;
    delete window.SpeechRecognition;
    unmount();
  });

  it('handles SpeechRecognition start/restart errors, missing constructor, and all pacingZone bounds', async () => {
    const { result, rerender } = renderHook(
      ({ running, elapsed, lang }) => useSpeechAnalytics(running, elapsed, lang),
      { initialProps: { running: true, elapsed: 0, lang: 'uk-UA' } }
    );

    await waitFor(() => expect(result.current.estimationMethod).toBe('audio_burst'));

    window.webkitSpeechRecognition = class {
      start() {
        throw new Error('start failed');
      }
      abort() {
        throw new Error('abort failed');
      }
    };

    await act(async () => {
      rerender({ running: false, elapsed: 0, lang: 'uk-UA' });
    });
    await act(async () => {
      rerender({ running: true, elapsed: 0, lang: 'uk-UA' });
    });
    await waitFor(() => expect(result.current.estimationMethod).toBe('audio_burst'));

    let recInstance = null;
    window.webkitSpeechRecognition = class {
      constructor() {
        recInstance = this;
        this.calls = 0;
      }
      start() {
        this.calls += 1;
        if (this.calls > 1) throw new Error('restart failed');
      }
      abort() {}
    };

    await act(async () => {
      result.current.resetAnalytics();
      rerender({ running: false, elapsed: 0, lang: 'uk-UA' });
    });
    await act(async () => {
      rerender({ running: true, elapsed: 0, lang: 'uk-UA' });
    });
    await waitFor(() => expect(recInstance).not.toBeNull());

    await flushRafFrame(100);
    await flushRafFrame(4000);
    await flushRafFrame(4500);
    await flushRafFrame(8200);
    await flushRafFrame(8700);

    await act(async () => {
      recInstance.onend();
    });
    expect(result.current.estimationMethod).toBe('audio_burst');

    await act(async () => {
      rerender({ running: true, elapsed: 60, lang: 'uk-UA' });
      result.current.setWordCount(80);
    });
    expect(result.current.pacingZone).toBe('too_slow');

    await act(async () => {
      result.current.setWordCount(130);
    });
    expect(result.current.pacingZone).toBe('optimal');

    await act(async () => {
      result.current.setWordCount(200);
    });
    expect(result.current.pacingZone).toBe('too_fast');
  });

  it('stops media stream tracks or ignores rejection if getUserMedia settles after running stops', async () => {
    const stopTrack = vi.fn();
    let resolveMedia;
    let rejectMedia;
    vi.spyOn(navigator.mediaDevices, 'getUserMedia')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMedia = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectMedia = reject;
          })
      );

    const { rerender } = renderHook(
      ({ running }) => useSpeechAnalytics(running, 0, 'en-US'),
      { initialProps: { running: true } }
    );

    await act(async () => {
      rerender({ running: false });
    });

    await act(async () => {
      resolveMedia({ getTracks: () => [{ stop: stopTrack }] });
    });

    expect(stopTrack).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ running: true });
    });
    await act(async () => {
      rerender({ running: false });
    });
    await act(async () => {
      rejectMedia(new Error('late rejection'));
    });
  });
});
