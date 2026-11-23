import { createLogger } from '../utils/logger.js';

const logger = createLogger('ASR:Adapter');
const CHUNK_LOG_INTERVAL_MS = 2000;

export class AsrEngineAdapter {
  constructor({ workerFactory, modelUrl, vadUrl, wasmUrl } = {}) {
    this.workerFactory = workerFactory;
    this.modelUrl = modelUrl;
    this.vadUrl = vadUrl;
    this.wasmUrl = wasmUrl;
    this.worker = null;
    this.chunksSent = 0;
    this.lastChunkLogMs = 0;
  }

  init({ lang = 'uk', onProgress, onTranscript, onError, onReady } = {}) {
    if (!this.workerFactory && typeof globalThis.Worker === 'undefined') {
      logger.error('Web Worker API unavailable');
      return Promise.reject(new Error('Web Worker API unavailable'));
    }

    const worker = this.workerFactory
      ? this.workerFactory()
      : new globalThis.Worker(new URL('../workers/asr.worker.js', import.meta.url), {
          type: 'module',
        });

    this.worker = worker;
    this.chunksSent = 0;
    this.lastChunkLogMs = 0;

    return new Promise((resolve, reject) => {
      let settled = false;

      worker.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === 'MODEL_PROGRESS') {
          const progress = {
            percent: Number(msg.percent ?? 0),
            cached: Boolean(msg.cached),
          };
          logger.debug('Model progress', progress);
          onProgress?.(progress);
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
          logger.info('Worker MODEL_READY', { lang });
          if (!settled) {
            settled = true;
            resolve();
          }
          onReady?.();
          return;
        }
        if (msg.type === 'ENGINE_ERROR') {
          const message = msg.message || 'ASR engine error';
          logger.error('Worker ENGINE_ERROR', { message });
          const err = new Error(message);
          if (!settled) {
            settled = true;
            reject(err);
          }
          onError?.(err);
        }
      };

      worker.onerror = (event) => {
        const message = event?.message || 'ASR worker crashed';
        logger.error('Worker crashed', { message });
        const err = new Error(message);
        if (!settled) {
          settled = true;
          reject(err);
        }
        onError?.(err);
      };

      logger.info('Sending INIT to ASR worker', {
        lang,
        modelUrl: this.modelUrl,
        vadUrl: this.vadUrl,
        wasmUrl: this.wasmUrl,
      });
      worker.postMessage({
        type: 'INIT',
        lang,
        modelUrl: this.modelUrl,
        vadUrl: this.vadUrl,
        wasmUrl: this.wasmUrl,
      });
    });
  }

  pushAudio(float32Chunk) {
    if (!this.worker || !float32Chunk) return;
    const isStandaloneFloat32 =
      float32Chunk instanceof Float32Array &&
      float32Chunk.byteOffset === 0 &&
      float32Chunk.byteLength === float32Chunk.buffer.byteLength;
    const chunk = isStandaloneFloat32 ? float32Chunk : new Float32Array(float32Chunk);
    const sampleCount = chunk.length;
    const byteLength = chunk.byteLength;
    this.chunksSent += 1;
    const now = performance.now();
    if (this.lastChunkLogMs === 0 || now - this.lastChunkLogMs >= CHUNK_LOG_INTERVAL_MS) {
      this.lastChunkLogMs = now;
      logger.debug('Transferred AUDIO_CHUNK', {
        chunksSent: this.chunksSent,
        sampleCount,
        byteLength,
      });
    }
    this.worker.postMessage(
      { type: 'AUDIO_CHUNK', samples: chunk },
      [chunk.buffer]
    );
  }

  finish() {
    this.worker?.postMessage({ type: 'FINISH' });
  }

  reset() {
    this.worker?.postMessage({ type: 'RESET' });
  }

  destroy() {
    if (this.worker) {
      this.worker.postMessage({ type: 'FINISH' });
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
