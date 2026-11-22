export class AsrEngineAdapter {
  constructor({ workerFactory, modelUrl, wasmJsUrl } = {}) {
    this.workerFactory = workerFactory;
    this.modelUrl = modelUrl;
    this.wasmJsUrl = wasmJsUrl;
    this.worker = null;
  }

  init({ lang = 'uk', onProgress, onTranscript, onError, onReady } = {}) {
    if (!this.workerFactory && typeof globalThis.Worker === 'undefined') {
      return Promise.reject(new Error('Web Worker API unavailable'));
    }

    const worker = this.workerFactory
      ? this.workerFactory()
      : new globalThis.Worker(new URL('../workers/asr.worker.js', import.meta.url), {
          type: 'module',
        });

    this.worker = worker;

    return new Promise((resolve, reject) => {
      let settled = false;

      worker.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === 'MODEL_PROGRESS') {
          onProgress?.({
            percent: Number(msg.percent ?? 0),
            cached: Boolean(msg.cached),
          });
          return;
        }
        if (msg.type === 'TRANSCRIPT_UPDATE') {
          onTranscript?.({
            words: Array.isArray(msg.words) ? msg.words : [],
            fullText: msg.fullText || '',
            isFinal: Boolean(msg.isFinal),
          });
          return;
        }
        if (msg.type === 'MODEL_READY') {
          if (!settled) {
            settled = true;
            resolve();
          }
          onReady?.();
          return;
        }
        if (msg.type === 'ENGINE_ERROR') {
          const err = new Error(msg.message || 'ASR engine error');
          if (!settled) {
            settled = true;
            reject(err);
          }
          onError?.(err);
        }
      };

      worker.onerror = (event) => {
        const err = new Error(event?.message || 'ASR worker crashed');
        if (!settled) {
          settled = true;
          reject(err);
        }
        onError?.(err);
      };

      worker.postMessage({
        type: 'INIT',
        lang,
        modelUrl: this.modelUrl,
        wasmJsUrl: this.wasmJsUrl,
      });
    });
  }

  pushAudio(float32Chunk) {
    if (!this.worker || !float32Chunk) return;
    const chunk =
      float32Chunk instanceof Float32Array
        ? float32Chunk
        : new Float32Array(float32Chunk);
    this.worker.postMessage(
      { type: 'AUDIO_CHUNK', samples: chunk },
      [chunk.buffer]
    );
  }

  reset() {
    this.worker?.postMessage({ type: 'RESET' });
  }

  destroy() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export function createDefaultAsrEngine(options) {
  return new AsrEngineAdapter(options);
}
