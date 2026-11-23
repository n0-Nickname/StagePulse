import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TARGET_SAMPLE_RATE,
  CHUNK_SAMPLES,
  computeRms,
  computePeak,
  createAgcProcessor,
  createResampler,
  startMicCapture,
} from './micCapture.js';

describe('audio/micCapture.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.AudioWorkletNode;
  });

  it('computes RMS, peak, and 3-tap anti-aliased resampler to 16kHz 640-sample chunks', () => {
    expect(computeRms(null)).toBe(0);
    expect(computeRms([])).toBe(0);
    expect(computeRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 5);

    expect(computePeak(null)).toBe(0);
    expect(computePeak([])).toBe(0);
    expect(computePeak(new Float32Array([0.1, -0.75, 0.3]))).toBeCloseTo(0.75, 5);

    const chunks = [];
    const rmsVals = [];
    // 48kHz -> 16kHz (ratio 3.0), chunk size 4
    const push48k = createResampler(
      48000,
      4,
      (c) => chunks.push(c),
      (r) => rmsVals.push(r)
    );
    push48k(new Float32Array(0));
    push48k(new Float32Array(15).fill(0.4));
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(4);
    expect(rmsVals[0]).toBeGreaterThan(0);

    // 16kHz -> 16kHz (ratio 1.0, bypasses anti-alias filter)
    const chunks16k = [];
    const push16k = createResampler(16000, 4, (c) => chunks16k.push(c));
    push16k(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]));
    expect(chunks16k.length).toBe(1);
  });

  it('throws cleanly when mediaDevices or AudioContext is missing', async () => {
    const origMedia = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    await expect(startMicCapture()).rejects.toThrow(/mediaDevices API unavailable/i);
    Object.defineProperty(navigator, 'mediaDevices', { value: origMedia, configurable: true });

    const origAC = globalThis.AudioContext;
    const origWac = globalThis.webkitAudioContext;
    delete globalThis.AudioContext;
    delete globalThis.webkitAudioContext;
    await expect(startMicCapture()).rejects.toThrow(/Web Audio API unavailable/i);
    globalThis.AudioContext = origAC;
    globalThis.webkitAudioContext = origWac;
  });

  it('uses native AudioContext + AudioWorkletNode with raw constraints and cleans up on stop()', async () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000);
    expect(CHUNK_SAMPLES).toBe(640);

    const stopTrack = vi.fn();
    const gumSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });

    const addModule = vi.fn().mockResolvedValue(undefined);
    const closeCtx = vi.fn();
    let capturedOpts = 'unset';
    const origAC = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor(opts) {
        capturedOpts = opts;
        this.state = 'running';
        this.sampleRate = 48000;
        this.audioWorklet = { addModule };
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      close() {
        closeCtx();
      }
    };

    let workletInstance = null;
    globalThis.AudioWorkletNode = class {
      constructor() {
        this.port = { onmessage: null };
        this.disconnect = vi.fn();
        workletInstance = this;
      }
    };

    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:worklet');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const onChunk = vi.fn();
    const onRms = vi.fn();
    const capture = await startMicCapture({ onChunk, onRms, silentCheckMs: 5000 });

    expect(capturedOpts).toBeUndefined(); // Native sampleRate (no { sampleRate: 16000 })
    expect(gumSpy).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    expect(addModule).toHaveBeenCalledWith('blob:worklet');
    expect(capture.audioContext.sampleRate).toBe(48000);
    expect(capture.stream).toBeTruthy();

    workletInstance.port.onmessage({ data: new Float32Array([0.2, -0.2]) });
    workletInstance.port.onmessage({ data: new Float32Array([0.4, -0.4]).buffer });
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onRms).toHaveBeenCalledTimes(2);

    capture.stop();
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:worklet');
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(closeCtx).toHaveBeenCalledTimes(1);

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
    globalThis.AudioContext = origAC;
  });

  it('falls back to ScriptProcessorNode and retries with { audio: true } after 2s of <0.001 peak', async () => {
    vi.useFakeTimers();
    const stopTrack1 = vi.fn();
    const stopTrack2 = vi.fn();
    const gumSpy = vi
      .spyOn(navigator.mediaDevices, 'getUserMedia')
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack1 }] })
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack2 }] });

    let scriptNode = null;
    const origAC = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor() {
        this.state = 'closed';
        this.sampleRate = 0; // exercises fallback `|| TARGET_SAMPLE_RATE`
        this.destination = {};
        this.audioWorklet = {
          addModule: vi.fn().mockRejectedValue(new Error('CSP blocked')),
        };
      }
      createMediaStreamSource() {
        return {
          connect: vi.fn(),
          disconnect: () => {
            throw new Error('already disconnected');
          },
        };
      }
      createScriptProcessor() {
        scriptNode = {
          onaudioprocess: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        return scriptNode;
      }
      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      close() {}
    };

    globalThis.AudioWorkletNode = class {};
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bad');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const onChunk = vi.fn();
    const capture = await startMicCapture({ onChunk, chunkSize: 4, silentCheckMs: 2000 });

    // Emit near-zero peak (<0.001)
    scriptNode.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array([0.0001, 0.0002, 0.0001, 0.0001, 0.0001]) },
    });
    expect(onChunk).toHaveBeenCalledTimes(1);

    // Trigger 2s silent check fallback -> retries getUserMedia({ audio: true })
    await vi.advanceTimersByTimeAsync(2000);
    expect(gumSpy).toHaveBeenNthCalledWith(2, { audio: true });
    expect(stopTrack1).toHaveBeenCalledTimes(1);

    // Emit peak on fallback stream
    scriptNode.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array([0.2, 0.2, 0.2, 0.2, 0.2]) },
    });

    capture.stop();
    expect(stopTrack2).toHaveBeenCalledTimes(1);

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
    globalThis.AudioContext = origAC;
  });

  it('handles silent-fallback rejection and stop() racing during fallback getUserMedia', async () => {
    vi.useFakeTimers();
    const stopTrack1 = vi.fn();
    const stopTrack2 = vi.fn();
    let resolveFallback;
    vi.spyOn(navigator.mediaDevices, 'getUserMedia')
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack1 }] })
      .mockRejectedValueOnce(new Error('fallback failed'))
      .mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack1 }] })
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveFallback = res;
          })
      );

    const origAC = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor() {
        this.state = 'running';
        this.sampleRate = 16000;
        this.destination = {};
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createScriptProcessor() {
        return { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() };
      }
      createGain() {
        return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      }
      close() {}
    };

    // Case A: fallback getUserMedia rejects
    const capA = await startMicCapture({ chunkSize: 4, silentCheckMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    capA.stop();

    // Case B: stop() called while fallback getUserMedia is pending
    const capB = await startMicCapture({ chunkSize: 4, silentCheckMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    capB.stop();
    resolveFallback({ getTracks: () => [{ stop: stopTrack2 }] });
    await vi.waitFor(() => expect(stopTrack2).toHaveBeenCalledTimes(1));

    // Case C: healthy mic peak (>= 0.001) skips fallback when silentCheckMs timer fires
    let healthyNode = null;
    globalThis.AudioContext.prototype.createScriptProcessor = function () {
      healthyNode = { onaudioprocess: null, connect: vi.fn(), disconnect: vi.fn() };
      return healthyNode;
    };
    const gumHealthy = vi
      .spyOn(navigator.mediaDevices, 'getUserMedia');
    gumHealthy.mockClear();
    gumHealthy.mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack1 }] });
    const capC = await startMicCapture({ chunkSize: 4, silentCheckMs: 500 });
    healthyNode.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array([0.5, 0.2, 0.1, 0.1]) },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(gumHealthy).toHaveBeenCalledTimes(1);
    capC.stop();

    globalThis.AudioContext = origAC;
  });

  it('logs AudioContext.sampleRate, resampler rates, chunk length, RMS, and clamps samples to [-1, 1]', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const chunks = [];
    const push = createResampler(48000, 4, (c) => chunks.push(c));
    push(new Float32Array(20).fill(2.5));
    push(new Float32Array(20).fill(-2.5));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const s of chunks[0]) {
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(-1);
    }
    expect(chunks.at(-1)[0]).toBeGreaterThanOrEqual(-1);

    const stopTrack = vi.fn();
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });
    let workletNode = null;
    const origAC = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor() {
        this.state = 'suspended';
        this.sampleRate = 48000;
        this.resume = vi.fn().mockImplementation(async () => {
          this.state = 'running';
        });
        this.audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      close() {}
    };
    globalThis.AudioWorkletNode = class {
      constructor() {
        this.port = { onmessage: null };
        this.disconnect = vi.fn();
        workletNode = this;
      }
    };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:clamp');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const received = [];
    const capture = await startMicCapture({ onChunk: (c) => received.push(c), silentCheckMs: 5000 });
    workletNode.port.onmessage({ data: new Float32Array([1.9, -1.7, Number.NaN, 0.25]) });
    expect(received[0].length).toBe(4);
    expect(received[0][0]).toBeLessThanOrEqual(1);
    expect(received[0][0]).toBeGreaterThan(0.9);
    expect(received[0][1]).toBeGreaterThanOrEqual(-1);
    expect(received[0][1]).toBeLessThan(-0.9);
    expect(received[0][2]).toBe(0);
    expect(received[0][3]).toBeCloseTo(Math.tanh(0.25), 5);

    const parsedLogs = logSpy.mock.calls.map((c) => JSON.parse(c[0]));
    expect(
      parsedLogs.some(
        (l) => l.logger === 'Audio:Mic' && l.sampleRate === 48000 && l.outputRate === 16000
      )
    ).toBe(true);
    expect(
      parsedLogs.some(
        (l) => l.logger === 'Audio:Mic' && l.chunkLength === 4 && typeof l.rms === 'number'
      )
    ).toBe(true);

    capture.stop();
    globalThis.AudioContext = origAC;
    vi.unstubAllEnvs();
  });

  it('applies lightweight AGC boost for quiet speech and soft-limiter without boosting silent noise floor', () => {
    const processAgc = createAgcProcessor();

    // Near-zero noise floor (< 0.001) is NOT boosted so silent-mic fallback remains accurate
    const silence = new Float32Array(640).fill(0.0002);
    processAgc(silence);
    expect(computePeak(silence)).toBeCloseTo(0.0002, 5);

    // Quiet speech (0.01 RMS) gets smoothly boosted toward target RMS without clipping
    const quiet = new Float32Array(640);
    for (let i = 0; i < quiet.length; i += 1) {
      quiet[i] = 0.01 * Math.sin(i * 0.1);
    }
    const beforeRms = computeRms(quiet);
    for (let pass = 0; pass < 5; pass += 1) {
      const frame = new Float32Array(quiet);
      processAgc(frame);
      if (pass === 4) {
        const afterRms = computeRms(frame);
        expect(afterRms).toBeGreaterThan(beforeRms * 2);
        expect(computePeak(frame)).toBeLessThan(1);
      }
    }

    // Ultra-quiet PipeWire mic speech (0.0008 RMS) is boosted above silence threshold
    const pipewireProcess = createAgcProcessor();
    const quietPipewire = new Float32Array(640);
    for (let i = 0; i < quietPipewire.length; i += 1) {
      quietPipewire[i] = 0.0012 * Math.sin(i * 0.1);
    }
    for (let pass = 0; pass < 8; pass += 1) {
      const frame = new Float32Array(quietPipewire);
      pipewireProcess(frame);
      if (pass === 7) {
        expect(computeRms(frame)).toBeGreaterThan(0.015);
      }
    }

    // Extreme values stay softly limited inside [-1, 1] and non-finite -> 0
    const extreme = new Float32Array([50, -50, Infinity, -Infinity]);
    processAgc(extreme);
    expect(extreme[0]).toBeLessThanOrEqual(1);
    expect(extreme[0]).toBeGreaterThan(0.99);
    expect(extreme[1]).toBeGreaterThanOrEqual(-1);
    expect(extreme[1]).toBeLessThan(-0.99);
    expect(extreme[2]).toBe(0);
    expect(extreme[3]).toBe(0);
  });
});
