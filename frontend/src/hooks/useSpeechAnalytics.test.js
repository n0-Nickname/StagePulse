import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useSpeechAnalytics,
  computeWordTimestampPauses,
  computeActiveSpeakingSec,
  computeOverallWpm,
  computeRollingWpm,
  countNormalizedWords,
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

    // Also supports { start, end } in seconds from tinyasr JSON
    expect(
      computeWordTimestampPauses(
        [
          { text: 'one', start: 0.2, end: 0.6 },
          { text: 'two', start: 2.4, end: 2.9 },
          { text: 'fallback' },
        ],
        3500
      )
    ).toEqual({
      pauseCount: 2,
      totalPauseSec: 5.3,
      isSilentPause: true,
      currentSilenceSec: 3.5,
    });

    // Guards against prevWord.endMs <= 0 when computing inter-word gaps
    expect(
      computeWordTimestampPauses(
        [
          { text: 'zero', startMs: 0, endMs: 0 },
          { text: 'later', startMs: 5000, endMs: 5500 },
        ],
        5500
      )
    ).toEqual({
      pauseCount: 0,
      totalPauseSec: 0,
      isSilentPause: false,
      currentSilenceSec: 0,
    });
  });

  it('computes overall WPM with 5-second warmup threshold and Pro-only custom filler matching', () => {
    expect(computeOverallWpm(10, 4)).toBe(0);
    expect(computeOverallWpm(0, 10)).toBe(0);
    expect(computeOverallWpm(15, 6)).toBe(150);

    expect(analyzeFillers('', ['like'], true)).toEqual({ fillerCount: 0, fillerBreakdown: {} });
    // Non-PRO returns 0 matches even with words provided
    expect(analyzeFillers('So basically like um ну типу', ['like', 'um', 'ну'], false)).toEqual({
      fillerCount: 0,
      fillerBreakdown: {},
    });
    // PRO with empty dictionary returns 0 matches (no hardcoded fillers)
    expect(analyzeFillers('So basically like um ну типу', [], true)).toEqual({
      fillerCount: 0,
      fillerBreakdown: {},
    });
    // PRO scans strictly against custom dictionary (single words & multi-word phrases in en/uk)
    expect(
      analyzeFillers('So basically like um hello like-minded', ['like', 'um', 'basically'], true)
    ).toEqual({
      fillerCount: 3,
      fillerBreakdown: { basically: 1, like: 1, um: 1 },
    });
    expect(
      analyzeFillers('Ну типу, як би, подібний приклад і як так', ['ну', 'як би', 'як', 'діб'], true)
    ).toEqual({
      fillerCount: 3,
      fillerBreakdown: {
        ну: 1,
        'як би': 1,
        як: 1,
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
      ({ running, elapsed, lang, isPro = true, userFillerWords = ['like'] }) =>
        useSpeechAnalytics(running, elapsed, lang, {
          engineFactory,
          micCaptureFactory,
          isPro,
          userFillerWords,
        }),
      { initialProps: { running: true, elapsed: 6, lang: 'en-US', isPro: true, userFillerWords: ['like'] } }
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

    // Emit timestamped words with a 1.8s committed word gap (2500 - 700 = 1800ms >= 1500ms)
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
    expect(result.current.pauseCount).toBe(1);
    expect(result.current.isSilentPause).toBe(false);
    expect(result.current.totalPauseSec).toBe(1.8);

    // Updating userFillerWords re-scans active transcript; !isPro clears filler stats
    act(() => {
      rerender({ running: true, elapsed: 6, lang: 'en-US', isPro: true, userFillerWords: ['like', 'world'] });
    });
    expect(result.current.fillerCount).toBe(2);
    expect(result.current.fillerBreakdown).toEqual({ like: 1, world: 1 });

    act(() => {
      rerender({ running: true, elapsed: 6, lang: 'en-US', isPro: false, userFillerWords: ['like', 'world'] });
    });
    expect(result.current.fillerCount).toBe(0);
    expect(result.current.fillerBreakdown).toEqual({});

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
          if (!resolveInit) resolveInit = res;
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
        if (!lateOpts) lateOpts = opts;
        return new Promise((_, rej) => {
          if (!rejectLateInit) rejectLateInit = rej;
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
      ({ running, elapsed, lang }) =>
        useSpeechAnalytics(running, elapsed, lang, {
          isPro: true,
          userFillerWords: ['like', 'um', 'basically'],
        }),
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

    // RMS remains purely visual; no RMS-driven pauses
    getFloat.mockImplementation((arr) => arr.fill(0.002));
    await flushRafFrame(1600);
    await flushRafFrame(3200);
    await flushRafFrame(3400);
    expect(result.current.pauseCount).toBe(0);
    expect(result.current.isSilentPause).toBe(false);

    getFloat.mockImplementation((arr) => arr.fill(0.4));
    await flushRafFrame(3500);
    expect(result.current.liveRmsRef.current).toBeGreaterThan(0);

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
      ({ running, elapsed, lang }) =>
        useSpeechAnalytics(running, elapsed, lang, {
          isPro: true,
          userFillerWords: ['ну', 'типу', 'власне'],
        }),
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
    expect(result.current.isSimulatingSilence).toBe(true);
    expect(result.current.liveRmsRef.current).toBeLessThan(0.1);

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

    // Exercise syllable burst > speechWords branch in speech_api mode
    const origAnalyser = window.AudioContext.prototype.createAnalyser;
    let fakeSample = 0.01;
    window.AudioContext.prototype.createAnalyser = () => ({
      fftSize: 512,
      frequencyBinCount: 256,
      smoothingTimeConstant: 0.75,
      getFloatTimeDomainData: (arr) => arr.fill(fakeSample),
      getByteFrequencyData: (arr) => arr.fill(50),
    });
    await act(async () => {
      rerender({ running: false, elapsed: 0, lang: 'uk-UA' });
    });
    await act(async () => {
      rerender({ running: true, elapsed: 0, lang: 'uk-UA' });
    });
    await waitFor(() => expect(recInstance).not.toBeNull());
    fakeSample = 0.01;
    await flushRafFrame(100);
    await flushRafFrame(1200); // calibrates low ambient threshold (0.045)
    fakeSample = 0.005;
    await flushRafFrame(1300); // arms burst
    fakeSample = 0.35;
    await flushRafFrame(1500); // triggers syllable burst while speechWords = 0
    window.AudioContext.prototype.createAnalyser = origAnalyser;

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

  it('surfaces ENGINE_ERROR via logger.error and engineError UI state on init rejection and runtime onError', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'error');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Case 1: WASM init rejection surfaces engineError while falling back
    const failFactory = () => ({
      init: vi.fn().mockRejectedValue(new Error('HTML 404 fallback for model')),
      destroy: vi.fn(),
    });
    const { result, unmount } = renderHook(() =>
      useSpeechAnalytics(true, 0, 'en-US', { engineFactory: failFactory })
    );
    await waitFor(() => expect(result.current.engineError).toBe('HTML 404 fallback for model'));
    expect(errorSpy).toHaveBeenCalled();

    await act(async () => {
      result.current.resetAnalytics();
    });
    expect(result.current.engineError).toBeNull();
    unmount();

    // Case 2: Runtime onError callback after init resolves
    let initOpts = null;
    const runtimeErrFactory = () => ({
      init: vi.fn(async (opts) => {
        initOpts = opts;
      }),
      pushAudio: vi.fn(),
      destroy: vi.fn(),
    });
    const runtimeCapFactory = vi.fn(async () => ({ stop: vi.fn() }));
    const { result: r2, unmount: u2 } = renderHook(() =>
      useSpeechAnalytics(true, 0, 'en-US', {
        engineFactory: runtimeErrFactory,
        micCaptureFactory: runtimeCapFactory,
      })
    );
    await waitFor(() => expect(initOpts).not.toBeNull());
    act(() => {
      initOpts.onError(new Error('Runtime WASM trap'));
    });
    expect(r2.current.engineError).toBe('Runtime WASM trap');
    u2();
    vi.unstubAllEnvs();
  });

  it('counts normalized words from partial fullText, excludes pre-speech dead air from WPM, and computes rolling 15s WPM', async () => {
    expect(countNormalizedWords('')).toBe(0);
    expect(countNormalizedWords('   ')).toBe(0);
    expect(countNormalizedWords('  Hello, world — test-case!  ')).toBe(4);

    expect(computeRollingWpm([], 10, 0)).toBe(0);
    expect(computeRollingWpm([{ t: 2, words: 5 }], 3, 2)).toBe(0); // < 3s window
    expect(
      computeRollingWpm(
        [
          { t: 10, words: 5 },
          { t: 25, words: 5 },
        ],
        30,
        10
      )
    ).toBe(0); // 0 deltaWords in rolling window
    // 10s..20s window => 10s, 20 words => 120 wpm
    expect(
      computeRollingWpm(
        [
          { t: 10, words: 2 },
          { t: 20, words: 20 },
        ],
        20,
        10
      )
    ).toBe(120);
    // Sliding 15s window at t=35s (baseline at t=20s had 20 words, t=35s has 50 => 30 words / 15s = 120 wpm)
    expect(
      computeRollingWpm(
        [
          { t: 10, words: 2 },
          { t: 20, words: 20 },
          { t: 35, words: 50 },
        ],
        35,
        10
      )
    ).toBe(120);

    let callbacks = null;
    const engineFactory = () => ({
      init: vi.fn(async (opts) => {
        callbacks = opts;
      }),
      pushAudio: vi.fn(),
      destroy: vi.fn(),
    });
    const micCaptureFactory = vi.fn(async () => ({ stop: vi.fn() }));

    const { result, rerender, unmount } = renderHook(
      ({ running, elapsed }) =>
        useSpeechAnalytics(running, elapsed, 'en-US', { engineFactory, micCaptureFactory }),
      { initialProps: { running: true, elapsed: 0 } }
    );
    await waitFor(() => expect(callbacks).not.toBeNull());

    // 10s of pre-speech dead air
    await act(async () => {
      rerender({ running: true, elapsed: 10 });
    });
    expect(result.current.wpm).toBe(0);

    // First speech detected at elapsed=10s via partial fullText (committed words still empty)
    act(() => {
      callbacks.onTranscript({
        words: [],
        fullText: 'One two three four five',
        isFinal: false,
      });
    });
    expect(result.current.wordCount).toBe(5);
    expect(result.current.words).toEqual([]);

    // At elapsed=20s (10s of active speaking, excluding 10s dead air), 20 words -> 120 WPM
    await act(async () => {
      rerender({ running: true, elapsed: 20 });
    });
    act(() => {
      callbacks.onTranscript({
        words: new Array(20).fill(0).map((_, i) => ({ text: `w${i}`, startMs: 10000 + i * 400, endMs: 10300 + i * 400 })),
        fullText: new Array(20).fill('word').join(' '),
        isFinal: true,
      });
    });
    expect(result.current.wpm).toBe(120);
    expect(result.current.rollingWpm).toBe(120);
    unmount();
  });

  it('coalesces rapid partial TRANSCRIPT_UPDATE messages (~135ms) and pre-warms WASM + CacheStorage on mount', async () => {
    vi.useFakeTimers();
    let callbacks = null;
    const initSpy = vi.fn(async (opts) => {
      callbacks = opts;
    });
    const engineFactory = vi.fn(() => ({
      init: initSpy,
      pushAudio: vi.fn(),
      destroy: vi.fn(),
    }));
    const micCaptureFactory = vi.fn(async () => ({ stop: vi.fn() }));

    // Mount with running=false -> triggers mount-time WASM warmup & CacheStorage check
    const { result, rerender, unmount } = renderHook(
      ({ running, elapsed }) =>
        useSpeechAnalytics(running, elapsed, 'uk-UA', { engineFactory, micCaptureFactory }),
      { initialProps: { running: false, elapsed: 0 } }
    );

    await vi.waitFor(() => expect(initSpy).toHaveBeenCalledTimes(1));
    expect(engineFactory).toHaveBeenCalledTimes(1);

    // Starting rehearsal reuses warmed engine without second init
    await act(async () => {
      rerender({ running: true, elapsed: 0 });
    });
    await vi.waitFor(() => expect(micCaptureFactory).toHaveBeenCalledTimes(1));
    expect(initSpy).toHaveBeenCalledTimes(1);

    // Leading partial fires immediately, rapid subsequent partials within 135ms coalesce
    act(() => {
      callbacks.onTranscript({ words: [], fullText: 'Перше', isFinal: false });
    });
    expect(result.current.liveTranscript).toBe('Перше');

    act(() => {
      callbacks.onTranscript({ words: [], fullText: 'Перше друге', isFinal: false });
      callbacks.onTranscript({ words: [], fullText: 'Перше друге третє', isFinal: false });
    });
    // Still 'Перше' before throttle window elapses
    expect(result.current.liveTranscript).toBe('Перше');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(result.current.liveTranscript).toBe('Перше друге третє');
    expect(result.current.wordCount).toBe(3);

    // Final commit arriving while a trailing partial timer is pending clears the timer immediately
    act(() => {
      callbacks.onTranscript({ words: [], fullText: 'Перше друге третє чотири', isFinal: false });
      callbacks.onTranscript({
        words: [{ text: 'final', startMs: 0, endMs: 200 }],
        fullText: 'final',
        isFinal: true,
      });
    });
    expect(result.current.liveTranscript).toBe('final');
    expect(result.current.wordCount).toBe(1);

    // Trigger pending partial timer right before unmount/stop to verify timer cleanup
    act(() => {
      callbacks.onTranscript({ words: [], fullText: 'final один', isFinal: false });
      callbacks.onTranscript({ words: [], fullText: 'final один два', isFinal: false });
    });

    vi.useRealTimers();
    unmount();
  });

  it('covers warmup cache edge cases, language mismatch invalidation, live callback handoff, and unmount cleanup', async () => {
    // 1. Missing caches.open + unmount while warmed engine is still idle
    const origCaches = globalThis.caches;
    Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true });

    let warmupOpts = null;
    let resolveWarmup = null;
    const destroySpy = vi.fn();
    const engineFactory = vi.fn(() => ({
      init: vi.fn((opts) => {
        warmupOpts = opts;
        return new Promise((res) => {
          resolveWarmup = res;
        });
      }),
      pushAudio: vi.fn(),
      destroy: destroySpy,
    }));

    const { rerender, unmount } = renderHook(
      ({ running, lang }) => useSpeechAnalytics(running, 0, lang, { engineFactory }),
      { initialProps: { running: false, lang: 'uk-UA' } }
    );
    await waitFor(() => expect(warmupOpts).not.toBeNull());

    // Unmount before starting -> destroys idle warmed engine
    unmount();
    expect(destroySpy).toHaveBeenCalledTimes(1);

    // 2. caches.open rejects + language switch invalidates warmed engine + cancellation during reused init
    Object.defineProperty(globalThis, 'caches', {
      value: { open: vi.fn().mockRejectedValue(new Error('Storage quota')) },
      configurable: true,
    });
    const h2 = renderHook(
      ({ running, lang }) =>
        useSpeechAnalytics(running, 0, lang, {
          engineFactory,
          micCaptureFactory: vi.fn(async () => ({ stop: vi.fn() })),
        }),
      { initialProps: { running: false, lang: 'uk-UA' } }
    );
    await waitFor(() => expect(engineFactory).toHaveBeenCalledTimes(2));

    // Switch to running with different language ('en-US') -> destroys 'uk' warmed adapter and creates fresh 'en' adapter
    await act(async () => {
      h2.rerender({ running: true, lang: 'en-US' });
    });
    await waitFor(() => expect(engineFactory).toHaveBeenCalledTimes(3));
    expect(destroySpy).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveWarmup();
    });
    h2.unmount();

    // 3. Reusing pending warmed engine: onProgress/onError fire after Start, then stop cancels before init resolves
    let pendingOpts = null;
    let resolvePending = null;
    const pendingFactory = vi.fn(() => ({
      init: vi.fn((opts) => {
        pendingOpts = opts;
        return new Promise((res) => {
          resolvePending = res;
        });
      }),
      destroy: destroySpy,
    }));
    const h3 = renderHook(
      ({ running }) => useSpeechAnalytics(running, 0, 'en-US', { engineFactory: pendingFactory }),
      { initialProps: { running: false } }
    );
    await waitFor(() => expect(pendingOpts).not.toBeNull());

    await act(async () => {
      h3.rerender({ running: true });
    });
    act(() => {
      pendingOpts.onProgress({ percent: 80, cached: false });
      pendingOpts.onError(new Error('Warmup error handed off'));
    });
    expect(h3.result.current.modelProgress.percent).toBe(80);
    expect(h3.result.current.engineError).toBe('Warmup error handed off');

    // Cancel while warmed initPromise is still awaiting
    await act(async () => {
      h3.rerender({ running: false });
    });
    await act(async () => {
      resolvePending();
    });
    h3.unmount();

    Object.defineProperty(globalThis, 'caches', { value: origCaches, configurable: true });
  });

  it('computes pauses exclusively from committedWords timestamps + live active pause timer after first spoken word', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_APP_ENV', 'dev');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    let callbacks = null;
    let captureOpts = null;
    const engineFactory = () => ({
      init: vi.fn(async (opts) => {
        callbacks = opts;
      }),
      pushAudio: vi.fn(),
      destroy: vi.fn(),
    });
    const micCaptureFactory = vi.fn(async (opts) => {
      captureOpts = opts;
      return { stop: vi.fn() };
    });

    const { result, rerender, unmount } = renderHook(
      ({ running, elapsed }) =>
        useSpeechAnalytics(running, elapsed, 'uk-UA', { engineFactory, micCaptureFactory }),
      { initialProps: { running: true, elapsed: 0 } }
    );
    await vi.waitFor(() => expect(captureOpts).not.toBeNull());

    // 1. Before first spoken word: even 3s of silence/low RMS does NOT trigger live pause
    act(() => {
      captureOpts.onRms(0.0001);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.pauseCount).toBe(0);
    expect(result.current.isSilentPause).toBe(false);
    expect(result.current.currentSilenceSec).toBe(0);

    // 2. First spoken word commits -> initializes lastWordActivityAt; <1500ms keeps isSpeaking=true
    act(() => {
      callbacks.onTranscript({
        words: [{ text: 'Перше', startMs: 3000, endMs: 3400 }],
        fullText: 'Перше',
        isFinal: true,
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.isSpeaking).toBe(true);
    expect(result.current.isSilentPause).toBe(false);
    expect(result.current.pauseCount).toBe(0);

    // 3. Partial text actively streaming -> suppresses live active pause even after >= 1500ms
    act(() => {
      callbacks.onTranscript({
        words: [{ text: 'Перше', startMs: 3000, endMs: 3400 }],
        fullText: 'Перше слово',
        isFinal: false,
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });
    expect(result.current.isSilentPause).toBe(false);
    expect(result.current.pauseCount).toBe(0);

    // 4. Commit clears partial streaming; after 2200ms without new words, live active pause ticks
    act(() => {
      callbacks.onTranscript({
        words: [
          { text: 'Перше', startMs: 3000, endMs: 3400 },
          { text: 'слово', startMs: 3500, endMs: 3900 },
        ],
        fullText: 'Перше слово',
        isFinal: true,
      });
    });
    // Low/high RMS does NOT trigger or reset pause
    act(() => {
      captureOpts.onRms(0.001);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200);
    });
    expect(result.current.isSilentPause).toBe(true);
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.currentSilenceSec).toBeGreaterThanOrEqual(2.0);
    expect(result.current.pauseCount).toBe(1);
    expect(result.current.totalPauseSec).toBeGreaterThanOrEqual(2.0);

    // 5. New words commit with a deterministic 2.2s gap (6100 - 3900 = 2200ms) -> live pause resets & committed gap takes over
    act(() => {
      callbacks.onTranscript({
        words: [
          { text: 'Перше', startMs: 3000, endMs: 3400 },
          { text: 'слово', startMs: 3500, endMs: 3900 },
          { text: 'далі', startMs: 6100, endMs: 6500 },
        ],
        fullText: 'Перше слово далі',
        isFinal: true,
      });
    });
    expect(result.current.isSilentPause).toBe(false);
    expect(result.current.isSpeaking).toBe(true);
    expect(result.current.currentSilenceSec).toBe(0);
    expect(result.current.pauseCount).toBe(1);
    expect(result.current.totalPauseSec).toBe(2.2);

    // Verify dev logger.debug logged committed word gap (prevWord, nextWord, gapMs)
    const debugMsgs = debugSpy.mock.calls.map((c) => `${c[0]} ${JSON.stringify(c[2] ?? {})}`);
    expect(
      debugMsgs.some(
        (m) => m.includes('слово') && m.includes('далі') && m.includes('"gapMs":2200')
      )
    ).toBe(true);

    // Stopping resets live timer cleanly
    await act(async () => {
      rerender({ running: false, elapsed: 10 });
    });
    expect(result.current.isSilentPause).toBe(false);

    vi.unstubAllEnvs();
    vi.useRealTimers();
    unmount();
  });

  it('caps extreme inter-word pause outliers (>15000ms) from skewing session average WPM while keeping active speaking time accurate', async () => {
    // 1) Pure helper: 10s gap (<=15s) keeps full speaking time; 60s gap (>15s) caps excess 45s
    expect(
      computeActiveSpeakingSec(20, [
        { text: 'a', startMs: 0, endMs: 1000 },
        { text: 'b', startMs: 11000, endMs: 12000 },
      ])
    ).toBe(20);

    expect(
      computeActiveSpeakingSec(75, [
        { text: 'a', startMs: 0, endMs: 5000 },
        { text: 'b', startMs: 65000, endMs: 70000 }, // 60,000ms gap -> 45,000ms outlier excess
      ])
    ).toBe(30); // 75 - 45 = 30s active speaking time

    expect(computeActiveSpeakingSec(30, [], 15000, 20000)).toBe(25); // 20s live silence -> 5s excess capped
    expect(
      computeActiveSpeakingSec(30, [
        { text: 'zero', startMs: 0, endMs: 0 },
        { text: 'next', startMs: 25000, endMs: 26000 },
      ])
    ).toBe(30); // prev.endMs <= 0 skipped

    // 2) Hook integration: 30 words spoken across 75s elapsed with a 60s away-from-mic gap -> WPM reflects 30s active time (60 WPM), not 75s (24 WPM)
    let callbacks = null;
    const engineFactory = () => ({
      init: vi.fn(async (opts) => {
        callbacks = opts;
      }),
      pushAudio: vi.fn(),
      destroy: vi.fn(),
    });
    const micCaptureFactory = vi.fn(async () => ({ stop: vi.fn() }));

    const { result, rerender, unmount } = renderHook(
      ({ running, elapsed }) =>
        useSpeechAnalytics(running, elapsed, 'en-US', { engineFactory, micCaptureFactory }),
      { initialProps: { running: true, elapsed: 75 } }
    );
    await waitFor(() => expect(callbacks).not.toBeNull());

    const wordsWithOutlier = [
      ...Array.from({ length: 15 }, (_, i) => ({
        text: `w${i}`,
        startMs: i * 300,
        endMs: i * 300 + 200,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        text: `w${15 + i}`,
        startMs: 64200 + i * 300, // 60,000ms gap after w14 (endMs=4400)
        endMs: 64400 + i * 300,
      })),
    ];

    act(() => {
      callbacks.onTranscript({
        words: wordsWithOutlier,
        fullText: wordsWithOutlier.map((w) => w.text).join(' '),
        isFinal: true,
      });
    });

    expect(result.current.wordCount).toBe(30);
    expect(result.current.wpm).toBe(60); // 30 words / (30s / 60) = 60 WPM

    await act(async () => {
      rerender({ running: false, elapsed: 75 });
    });
    unmount();
  });
});
