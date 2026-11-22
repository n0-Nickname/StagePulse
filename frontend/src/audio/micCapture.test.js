import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TARGET_SAMPLE_RATE,
  CHUNK_SAMPLES,
  computeRms,
  createSampleChunker,
  startMicCapture,
} from './micCapture.js';

describe('audio/micCapture.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.AudioWorkletNode;
  });

  it('computes RMS and accumulates exact 1600-sample chunks', () => {
    expect(computeRms(null)).toBe(0);
    expect(computeRms([])).toBe(0);
    expect(computeRms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 5);

    const chunks = [];
    const rmsVals = [];
    const push = createSampleChunker(
      4,
      (c) => chunks.push(c),
      (r) => rmsVals.push(r)
    );

    push(new Float32Array([0.1, 0.2]));
    expect(chunks.length).toBe(0);
    push(new Float32Array([0.3, 0.4, 0.5, 0.6]));
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(4);
    expect(rmsVals[0]).toBeGreaterThan(0);
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

  it('uses AudioWorkletNode at 16kHz when supported and cleans up on stop()', async () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000);
    expect(CHUNK_SAMPLES).toBe(1600);

    const stopTrack = vi.fn();
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });

    const addModule = vi.fn().mockResolvedValue(undefined);
    const closeCtx = vi.fn();
    let capturedOpts = null;
    const origAC = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor(opts) {
        capturedOpts = opts;
        this.state = 'running';
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
    const capture = await startMicCapture({ onChunk, onRms });

    expect(capturedOpts).toEqual({ sampleRate: 16000 });
    expect(addModule).toHaveBeenCalledWith('blob:worklet');

    // Emit Float32Array and raw buffer from worklet port
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

  it('falls back to ScriptProcessorNode when AudioWorklet fails or is absent', async () => {
    const stopTrack = vi.fn();
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValueOnce({
      getTracks: () => [{ stop: stopTrack }],
    });

    let scriptNode = null;
    const origAC = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor() {
        this.state = 'closed';
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
    const capture = await startMicCapture({ onChunk, chunkSize: 4 });

    scriptNode.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array([0.1, 0.2, 0.3, 0.4]) },
    });
    expect(onChunk).toHaveBeenCalledTimes(1);

    capture.stop();
    expect(stopTrack).toHaveBeenCalledTimes(1);

    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
    globalThis.AudioContext = origAC;
  });
});
