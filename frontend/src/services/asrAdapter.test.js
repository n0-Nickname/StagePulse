import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AsrEngineAdapter, createDefaultAsrEngine } from './asrAdapter.js';

describe('services/asrAdapter.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete globalThis.Worker;
  });

  it('rejects when Worker API is unavailable and no workerFactory is supplied', async () => {
    const adapter = createDefaultAsrEngine();
    await expect(adapter.init({ lang: 'en' })).rejects.toThrow(/Worker API unavailable/i);
  });

  it('handles MODEL_PROGRESS, MODEL_READY, TRANSCRIPT_UPDATE, pushAudio transferable, reset, and destroy', async () => {
    let workerInstance = null;
    const workerFactory = () => {
      workerInstance = {
        onmessage: null,
        onerror: null,
        postMessage: vi.fn(),
        terminate: vi.fn(),
      };
      return workerInstance;
    };

    const adapter = new AsrEngineAdapter({
      workerFactory,
      modelUrl: '/models/en-ru-uk.tzf.gz',
      vadUrl: '/models/silero_vad.onnx.gz',
      wasmUrl: '/wasm/tinyasr.wasm',
    });

    const onProgress = vi.fn();
    const onTranscript = vi.fn();
    const onReady = vi.fn();

    const initPromise = adapter.init({
      lang: 'uk',
      onProgress,
      onTranscript,
      onReady,
    });

    expect(workerInstance.postMessage).toHaveBeenCalledWith({
      type: 'INIT',
      lang: 'uk',
      modelUrl: '/models/en-ru-uk.tzf.gz',
      vadUrl: '/models/silero_vad.onnx.gz',
      wasmUrl: '/wasm/tinyasr.wasm',
    });

    workerInstance.onmessage({ data: { type: 'MODEL_PROGRESS', percent: 50, cached: false } });
    expect(onProgress).toHaveBeenCalledWith({ percent: 50, cached: false });

    // Unknown/empty message ignored cleanly
    workerInstance.onmessage({ data: null });
    workerInstance.onmessage({ data: { type: 'MODEL_PROGRESS' } });

    workerInstance.onmessage({ data: { type: 'MODEL_READY' } });
    await initPromise;
    expect(onReady).toHaveBeenCalledTimes(1);

    // Second MODEL_READY after settled still invokes onReady
    workerInstance.onmessage({ data: { type: 'MODEL_READY' } });
    expect(onReady).toHaveBeenCalledTimes(2);

    workerInstance.onmessage({
      data: {
        type: 'TRANSCRIPT_UPDATE',
        words: [{ text: 'hello', startMs: 0, endMs: 400 }],
        fullText: 'hello',
        isFinal: true,
      },
    });
    expect(onTranscript).toHaveBeenCalledWith({
      words: [{ text: 'hello', startMs: 0, endMs: 400 }],
      fullText: 'hello',
      isFinal: true,
    });

    workerInstance.onmessage({ data: { type: 'TRANSCRIPT_UPDATE' } });
    expect(onTranscript).toHaveBeenLastCalledWith({
      words: [],
      fullText: '',
      isFinal: false,
    });

    // pushAudio with Float32Array and raw array
    const chunk = new Float32Array([0.1, 0.2]);
    adapter.pushAudio(chunk);
    expect(workerInstance.postMessage).toHaveBeenLastCalledWith(
      { type: 'AUDIO_CHUNK', samples: chunk },
      [chunk.buffer]
    );

    adapter.pushAudio([0.3, 0.4]);
    adapter.pushAudio(null);

    adapter.reset();
    expect(workerInstance.postMessage).toHaveBeenLastCalledWith({ type: 'RESET' });

    adapter.finish();
    expect(workerInstance.postMessage).toHaveBeenLastCalledWith({ type: 'FINISH' });

    adapter.destroy();
    expect(workerInstance.postMessage).toHaveBeenLastCalledWith({ type: 'FINISH' });
    expect(workerInstance.terminate).toHaveBeenCalledTimes(1);
    adapter.destroy(); // no-op when already destroyed
  });

  it('rejects init and notifies onError on ENGINE_ERROR and worker.onerror, and supports default global Worker', async () => {
    let created = null;
    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        created = this;
      }
    };

    const onError = vi.fn();
    const adapter = new AsrEngineAdapter();
    const p1 = adapter.init({ onError });

    created.onmessage({ data: { type: 'ENGINE_ERROR', message: 'Model fetch failed' } });
    await expect(p1).rejects.toThrow('Model fetch failed');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Model fetch failed' }));

    // Subsequent ENGINE_ERROR / worker.onerror after settled still invoke onError
    created.onmessage({ data: { type: 'ENGINE_ERROR' } });
    created.onerror({});
    expect(onError).toHaveBeenCalledTimes(3);

    // Worker.onerror rejecting unsettled init
    const adapter2 = new AsrEngineAdapter();
    const p2 = adapter2.init({ onError });
    created.onerror({ message: 'Worker crashed' });
    await expect(p2).rejects.toThrow('Worker crashed');
  });

  it('logs INIT, MODEL_READY, ENGINE_ERROR, and handles zero-copy subarray views safely', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let workerInstance = null;
    const adapter = new AsrEngineAdapter({
      workerFactory: () => {
        workerInstance = {
          onmessage: null,
          onerror: null,
          postMessage: vi.fn(),
          terminate: vi.fn(),
        };
        return workerInstance;
      },
    });

    const onError = vi.fn();
    const p = adapter.init({ lang: 'uk', onError });
    workerInstance.onmessage({ data: { type: 'MODEL_READY' } });
    await p;

    // Subarray view must be copied to its own buffer before transferring
    const backing = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const subview = backing.subarray(1, 3);
    adapter.pushAudio(subview);
    const [payload, transfers] = workerInstance.postMessage.mock.calls.at(-1);
    expect(payload.type).toBe('AUDIO_CHUNK');
    expect(Array.from(payload.samples)).toEqual([0.20000000298023224, 0.30000001192092896]);
    expect(transfers[0]).not.toBe(backing.buffer);

    workerInstance.onmessage({ data: { type: 'ENGINE_ERROR', message: 'Corrupt WASM' } });
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.parse(errorSpy.mock.calls[0][0])).toMatchObject({
      level: 'error',
      logger: 'ASR:Adapter',
      message: 'Corrupt WASM',
    });

    expect(
      logSpy.mock.calls.some((c) => c[0].includes('"logger":"ASR:Adapter"') && c[0].includes('INIT'))
    ).toBe(true);
  });
});
