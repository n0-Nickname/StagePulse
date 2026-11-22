import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSpeechAnalytics } from './useSpeechAnalytics.js';

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

    // Emit speech result with empty transcript first (recentText === ''), then real + filler words
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

    // Run rAF frames: early throttled frame (<50ms), ambient calibration (1000ms), voice, then silence > 1500ms
    await flushRafFrame(10);
    await flushRafFrame(100);
    await flushRafFrame(1200); // Triggers 1s ambient calibration

    // Trigger syllable dip & peak (dynamicThreshold after 0.08 calibration is 0.176)
    getFloat.mockImplementation((arr) => arr.fill(0.005));
    await flushRafFrame(1300); // Silence start + dip arms burst
    getFloat.mockImplementation((arr) => arr.fill(0.4));
    await flushRafFrame(1500); // Peak triggers syllable burst

    // Sustained silence >= 1500ms triggers pauseCount=1 and increments totalPauseSec
    getFloat.mockImplementation((arr) => arr.fill(0.002));
    await flushRafFrame(1600);
    await flushRafFrame(3200); // +1600ms silence -> pause detected
    await flushRafFrame(3400); // continued silence -> accumulates totalPauseSec

    expect(result.current.pauseCount).toBe(1);
    expect(result.current.isSilentPause).toBe(true);
    expect(result.current.totalPauseSec).toBeGreaterThan(1.5);

    // Recover from pause
    getFloat.mockImplementation((arr) => arr.fill(0.4));
    await flushRafFrame(3500);
    expect(result.current.isSilentPause).toBe(false);

    // Advance elapsed to 10s so pacingTimeline records bucket
    await act(async () => {
      rerender({ running: true, elapsed: 10, lang: 'en-US' });
    });
    expect(result.current.pacingTimeline.length).toBe(1);
    expect(['too_slow', 'optimal', 'too_fast']).toContain(result.current.pacingZone);

    // Test recognition.onend auto-restart & error fallback (empty error then fatal error)
    await act(async () => {
      lastRec.onend();
      lastRec.onerror({ error: '' });
      lastRec.onerror({ error: 'network' });
    });
    expect(result.current.estimationMethod).toBe('audio_burst');

    // Keep stale raf callback to verify tick returns early when isRunning becomes false
    const staleBatch = [...rafCallbacks];
    await act(async () => {
      rerender({ running: false, elapsed: 10, lang: 'en-US' });
    });
    await act(async () => {
      for (const item of staleBatch) {
        item.cb(4000);
      }
    });

    // Reset analytics
    await act(async () => {
      result.current.resetAnalytics();
    });
    expect(result.current.wordCount).toBe(0);
    expect(result.current.pauseCount).toBe(0);

    window.AudioContext.prototype.createAnalyser = origCreateAnalyser;
    unmount();
  });

  it('falls back to simulated mic when getUserMedia rejects (with or without message) or mediaDevices missing, and supports uk-UA fillers & webkitAudioContext', async () => {
    const origMediaDevices = navigator.mediaDevices;
    const origAC = window.AudioContext;
    delete window.AudioContext; // Force webkitAudioContext branch
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

    // Simulated speech frames (micro-breathing and syllable modulation + syllable bursts in audio_burst mode)
    await flushRafFrame(100);
    await flushRafFrame(1300); // dip/peak modulation
    await flushRafFrame(4000); // cycle > 0.86 micro-breathing (low rms -> arms burst)
    await flushRafFrame(4500); // cycle < 0.86 -> peak triggers burst in audio_burst mode!

    // Enable simulated silence
    await act(async () => {
      result.current.setIsSimulatingSilence(true);
    });
    await flushRafFrame(4600);
    await flushRafFrame(6300);
    expect(result.current.pauseCount).toBeGreaterThanOrEqual(1);

    // Stop running cleans up
    await act(async () => {
      rerender({ running: false, elapsed: 15, lang: 'uk-UA' });
    });
    expect(result.current.isSilentPause).toBe(false);

    // Real mic + webkitAudioContext + uk-UA filler detection
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

    // Also test missing mediaDevices API branch
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

  it('handles SpeechRecognition start/restart errors and missing SpeechRecognition constructor', async () => {
    const { result, rerender } = renderHook(
      ({ running, elapsed, lang }) => useSpeechAnalytics(running, elapsed, lang),
      { initialProps: { running: true, elapsed: 0, lang: 'uk-UA' } }
    );

    await waitFor(() => expect(result.current.estimationMethod).toBe('audio_burst'));

    // Now simulate SpeechRecognition throwing on start() and onend() restart
    let restartShouldThrow = true;
    window.webkitSpeechRecognition = class {
      start() {
        if (restartShouldThrow) {
          throw new Error('start failed');
        }
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

    // Also test onend throwing when restarting
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

    // Trigger syllable burst while speechWords === 0 in speech_api mode (line 338)
    await flushRafFrame(100);
    await flushRafFrame(4000);
    await flushRafFrame(4500);
    await flushRafFrame(8200);
    await flushRafFrame(8700);

    await act(async () => {
      recInstance.onend();
    });
    expect(result.current.estimationMethod).toBe('audio_burst');

    // Test fast/slow pacing zones directly via setWordCount
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
