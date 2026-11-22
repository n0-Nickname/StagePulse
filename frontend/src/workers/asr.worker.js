const CACHE_NAME = 'tinyasr-models-v1';
const DEFAULT_MODEL_URL = '/wasm/tinyasr-en-ru-uk.bin';
const DEFAULT_WASM_JS_URL = '/wasm/tinyasr.js';
const ESTIMATED_MODEL_BYTES = 31_900_000;

let decoder = null;
let accumulatedWords = [];

async function loadModelWithProgress(modelUrl) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResp = await cache.match(modelUrl);
  if (cachedResp) {
    const buf = await cachedResp.arrayBuffer();
    self.postMessage({ type: 'MODEL_PROGRESS', percent: 100, cached: true });
    return new Uint8Array(buf);
  }

  self.postMessage({ type: 'MODEL_PROGRESS', percent: 0, cached: false });
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch model weights (${response.status})`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || ESTIMATED_MODEL_BYTES;
  const responseClone = response.clone();

  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const percent = Math.min(99, Math.round((received / totalBytes) * 100));
      self.postMessage({ type: 'MODEL_PROGRESS', percent, cached: false });
    }

    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const buf = await response.arrayBuffer();
    bytes = new Uint8Array(buf);
  }

  await cache.put(modelUrl, responseClone);
  self.postMessage({ type: 'MODEL_PROGRESS', percent: 100, cached: false });
  return bytes;
}

async function initEngine({ lang = 'uk', modelUrl = DEFAULT_MODEL_URL, wasmJsUrl = DEFAULT_WASM_JS_URL }) {
  accumulatedWords = [];
  const weights = await loadModelWithProgress(modelUrl);
  const mod = globalThis.tinyasr || (await import(/* @vite-ignore */ wasmJsUrl));

  if (typeof mod.default === 'function') {
    await mod.default();
  }

  if (typeof mod.TinyAsrDecoder === 'function') {
    decoder = new mod.TinyAsrDecoder(weights, { lang });
  } else if (typeof mod.createDecoder === 'function') {
    decoder = await mod.createDecoder(weights, { lang });
  } else {
    throw new Error('tinyasr WASM module does not export a streaming decoder');
  }

  self.postMessage({ type: 'MODEL_READY' });
}

self.onmessage = async (event) => {
  const payload = event.data || {};

  if (payload.type === 'INIT') {
    try {
      await initEngine(payload);
    } catch (err) {
      self.postMessage({
        type: 'ENGINE_ERROR',
        message: err?.message || 'Failed to initialize tinyasr worker',
      });
    }
    return;
  }

  if (payload.type === 'AUDIO_CHUNK') {
    if (!decoder) return;
    const samples =
      payload.samples instanceof Float32Array
        ? payload.samples
        : new Float32Array(payload.samples);
    const result = decoder.processChunk(samples);
    if (result) {
      const nextWords = Array.isArray(result.words) ? result.words : [];
      if (result.isFinal && nextWords.length > 0) {
        accumulatedWords = nextWords;
      }
      const words = nextWords.length > 0 ? nextWords : accumulatedWords;
      const fullText =
        result.fullText || words.map((w) => w.text).join(' ').trim();
      self.postMessage({
        type: 'TRANSCRIPT_UPDATE',
        words,
        fullText,
        isFinal: Boolean(result.isFinal),
      });
    }
    return;
  }

  if (payload.type === 'RESET') {
    accumulatedWords = [];
    decoder?.reset?.();
  }
};
