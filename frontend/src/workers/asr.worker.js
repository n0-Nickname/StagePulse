import { createLogger } from '../utils/logger.js';

const CACHE_NAME = 'tinyasr-models-v1';
const DEFAULT_MODEL_URL = '/models/en-ru-uk.tzf.gz';
const DEFAULT_VAD_URL = '/models/silero_vad.onnx.gz';
const DEFAULT_ST_WASM_URL = '/wasm/tinyasr.wasm';
const DEFAULT_MT_WASM_URL = '/wasm/tinyasr-mt.wasm';
const ESTIMATED_TOTAL_BYTES = 33_800_000;
const CHUNK_LOG_INTERVAL_MS = 2000;
const DEFAULT_PCM_BUFFER_BYTES = 4096;
const DEFAULT_ENDPOINT_SILENCE_MS = 550;
const ENDPOINT_SILENCE_RMS = 0.008;
const HELPER_SPIN = 2000;
const HELPER_STACK_BYTES = 1 << 20;

const HELPER_WORKER_CODE = `
onmessage = (ev) => {
  const w = ev.data;
  const e = new WebAssembly.Instance(w.mod, {
    env: {
      memory: w.memory,
      now: () => performance.now() / 1000,
      parallel_for: () => { throw new Error('nested parallel step'); },
    },
  }).exports;
  e.__stack_pointer.value = w.top;
  e.__wasm_init_tls(w.tls);
  postMessage('up');
  const ctl = w.ctl;
  let seen = 0;
  for (;;) {
    for (let k = 0; Atomics.load(ctl, 0) === seen; k++) {
      if (k > w.spin) Atomics.wait(ctl, 0, seen);
    }
    seen = Atomics.load(ctl, 0);
    const n = ctl[1], task = ctl[4], ctx = ctl[5];
    for (;;) {
      const i = Atomics.add(ctl, 2, 1);
      if (i >= n) break;
      e.tinyasr_web_task(task, ctx, i);
    }
    Atomics.add(ctl, 3, 1);
    Atomics.notify(ctl, 3);
  }
};
`;

const logger = createLogger('ASR:Worker');

let exportsApi = null;
let wasmMemory = null;
let activeWasmBinary = 'tinyasr.wasm';
let helperCount = 0;
let helperWorkers = [];
let helperBlobUrl = null;
let modelHandle = 0;
let sessionHandle = 0;
let currentActiveLang = 'uk';
let endpointSilenceMs = DEFAULT_ENDPOINT_SILENCE_MS;
let pcmBufPtr = 0;
let pcmBufCapacity = 0;
let committedWords = [];
let committedText = '';
let hasPendingPartial = false;
let silenceAccumMs = 0;
let sessionAudioMs = 0;
let sessionAudioOffsetMs = 0;
let chunkCounter = 0;
let lastChunkLogMs = 0;
let totalAudioMs = 0;
let totalInferMs = 0;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function resolveWasmConfig(overrideUrl) {
  if (overrideUrl) {
    return {
      url: overrideUrl,
      variant: overrideUrl.includes('tinyasr-mt') ? 'mt' : 'st',
      explicit: true,
    };
  }
  const mtSupported =
    Boolean(self.crossOriginIsolated) &&
    typeof SharedArrayBuffer !== 'undefined' &&
    (navigator?.hardwareConcurrency || 1) > 1;
  return {
    url: mtSupported ? DEFAULT_MT_WASM_URL : DEFAULT_ST_WASM_URL,
    variant: mtSupported ? 'mt' : 'st',
    explicit: false,
  };
}

function getMemoryBuffer() {
  return (exportsApi && exportsApi.memory ? exportsApi.memory : wasmMemory).buffer;
}

function allocBytes(bytes) {
  const ptr = exportsApi.tinyasr_alloc(bytes.length);
  new Uint8Array(getMemoryBuffer(), ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function allocCString(str) {
  const encoded = textEncoder.encode(`${str}\0`);
  return allocBytes(encoded);
}

function readCString(ptr) {
  if (!ptr) return '';
  const mem = new Uint8Array(getMemoryBuffer());
  let end = ptr;
  while (end < mem.length && mem[end] !== 0) {
    end += 1;
  }
  return textDecoder.decode(mem.slice(ptr, end));
}

function computeChunkRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function normalizePcmChunk(input) {
  if (!input || input.length === 0) {
    throw new Error('Cannot push empty PCM chunk to tinyasr_session_push');
  }
  const src = input instanceof Float32Array ? input : new Float32Array(input);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 1) {
    const v = src[i];
    if (!Number.isFinite(v)) {
      out[i] = 0;
    } else if (v > 1) {
      out[i] = 1;
    } else if (v < -1) {
      out[i] = -1;
    } else {
      out[i] = v;
    }
  }
  return out;
}

export function validateAssetResponse(url, response, bytes) {
  if (!bytes || bytes.byteLength === 0) {
    throw new Error(`Empty response buffer for ${url}`);
  }
  const contentType = response?.headers?.get?.('content-type') || '';
  if (/text\/html/i.test(contentType)) {
    throw new Error(`HTML fallback response (content-type: ${contentType}) for ${url}`);
  }
  const prefix = textDecoder.decode(bytes.subarray(0, Math.min(bytes.byteLength, 64)));
  if (/^\s*(<!doctype|<html)/i.test(prefix)) {
    throw new Error(`HTML fallback payload detected for ${url}`);
  }
  const rawContentLen = response?.headers?.get?.('content-length');
  const expectedLen = rawContentLen ? Number(rawContentLen) : 0;
  if (Number.isFinite(expectedLen) && expectedLen > 0 && bytes.byteLength < expectedLen) {
    throw new Error(
      `Truncated response for ${url}: received ${bytes.byteLength} of ${expectedLen} bytes`
    );
  }
  if (url.endsWith('.wasm')) {
    const isWasmMagic =
      bytes.byteLength >= 8 &&
      bytes[0] === 0x00 &&
      bytes[1] === 0x61 &&
      bytes[2] === 0x73 &&
      bytes[3] === 0x6d;
    if (!isWasmMagic) {
      throw new Error(`Invalid WASM magic bytes for ${url}`);
    }
  }
}

async function maybeDecompressGzip(uint8) {
  if (uint8.length >= 2 && uint8[0] === 0x1f && uint8[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([uint8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    const out = new Uint8Array(buf);
    if (out.byteLength === 0) {
      throw new Error('Decompressed gzip payload is empty');
    }
    return out;
  }
  return uint8;
}

export async function fetchCachedBytes(url, onProgressChunk) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResp = await cache.match(url);
  if (cachedResp) {
    try {
      const buf = await cachedResp.arrayBuffer();
      const rawBytes = new Uint8Array(buf);
      validateAssetResponse(url, cachedResp, rawBytes);
      const bytes = await maybeDecompressGzip(rawBytes);
      logger.info('Cache hit', {
        url,
        compressedBytes: rawBytes.byteLength,
        decompressedBytes: bytes.byteLength,
      });
      return { bytes, cached: true };
    } catch (err) {
      logger.warn('Evicting invalid cached entry', { url, reason: err?.message });
      await cache.delete(url);
    }
  }

  logger.info('Cache miss, fetching asset', { url });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  const totalBytes = Number(response.headers?.get?.('content-length')) || 0;
  const responseClone = response.clone();
  let compressed;

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgressChunk(value.byteLength, totalBytes);
    }
    compressed = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      compressed.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const buf = await response.arrayBuffer();
    compressed = new Uint8Array(buf);
    onProgressChunk(compressed.byteLength, compressed.byteLength);
  }

  validateAssetResponse(url, response, compressed);
  const bytes = await maybeDecompressGzip(compressed);
  await cache.put(url, responseClone);
  logger.debug('Asset fetched and cached', {
    url,
    compressedBytes: compressed.byteLength,
    decompressedBytes: bytes.byteLength,
  });
  return { bytes, cached: false };
}

function joinCommittedWords(words) {
  let out = '';
  for (const w of words) {
    if (!out || w.join) {
      out += w.text;
    } else {
      out += ` ${w.text}`;
    }
  }
  return out.trim();
}

function extractSegmentText(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (Array.isArray(part)) {
    const mapped = part.map((w) =>
      typeof w === 'string' ? { text: w, join: false } : { text: w?.text || '', join: Boolean(w?.join) }
    );
    return joinCommittedWords(mapped);
  }
  return String(part);
}

export function emitEventsFromJson(jsonText) {
  if (!jsonText) return;
  let events;
  try {
    events = JSON.parse(jsonText);
  } catch {
    return;
  }
  if (!Array.isArray(events)) return;

  for (const ev of events) {
    if (ev.type === 'commit' || Array.isArray(ev.words)) {
      const mapped = (ev.words || []).map((w) => ({
        text: w.text || '',
        startMs: sessionAudioOffsetMs + Math.round((w.start ?? 0) * 1000),
        endMs: sessionAudioOffsetMs + Math.round((w.end ?? 0) * 1000),
        join: Boolean(w.join),
      }));
      committedWords = committedWords.concat(mapped);
      committedText = joinCommittedWords(committedWords);
      hasPendingPartial = false;
      self.postMessage({
        type: 'TRANSCRIPT_UPDATE',
        words: [...committedWords],
        fullText: committedText,
        isFinal: true,
      });
    } else if (ev.type === 'partial' || 'open' in ev || 'tail' in ev) {
      const openText = extractSegmentText(ev.open);
      const tailText = extractSegmentText(ev.tail);
      hasPendingPartial = Boolean(openText || tailText);
      const partialText = [committedText, openText, tailText].filter(Boolean).join(' ').trim();
      self.postMessage({
        type: 'TRANSCRIPT_UPDATE',
        words: [...committedWords],
        fullText: partialText,
        isFinal: false,
      });
    }
  }
}

function ensurePcmBuffer(byteLength) {
  if (pcmBufPtr && pcmBufCapacity >= byteLength) {
    return pcmBufPtr;
  }
  if (pcmBufPtr) {
    exportsApi.tinyasr_dealloc(pcmBufPtr, pcmBufCapacity);
    pcmBufPtr = 0;
    pcmBufCapacity = 0;
  }
  const allocBytesLen = Math.max(byteLength, DEFAULT_PCM_BUFFER_BYTES);
  pcmBufPtr = exportsApi.tinyasr_alloc(allocBytesLen);
  pcmBufCapacity = allocBytesLen;
  return pcmBufPtr;
}

function freePcmBuffer() {
  if (exportsApi && pcmBufPtr) {
    exportsApi.tinyasr_dealloc(pcmBufPtr, pcmBufCapacity);
  }
  pcmBufPtr = 0;
  pcmBufCapacity = 0;
}

function finishActiveSession({ keepPcmBuffer = false } = {}) {
  if (!exportsApi || !sessionHandle) {
    if (!keepPcmBuffer) freePcmBuffer();
    return;
  }
  try {
    const finalPtr = exportsApi.tinyasr_session_finish(sessionHandle);
    if (finalPtr) {
      emitEventsFromJson(readCString(finalPtr));
    }
  } finally {
    exportsApi.tinyasr_session_free(sessionHandle);
    sessionHandle = 0;
    if (!keepPcmBuffer) {
      freePcmBuffer();
    }
  }
}

function openAsrSession(activeLang) {
  const langsCstr = allocCString(activeLang);
  const startLangCstr = allocCString(activeLang);

  try {
    sessionHandle = exportsApi.tinyasr_session_new(
      modelHandle,
      langsCstr.ptr,
      startLangCstr.ptr,
      exportsApi.tinyasr_clock(),
      1
    );
    if (!sessionHandle) {
      throw new Error('tinyasr_session_new failed');
    }
    ensurePcmBuffer(DEFAULT_PCM_BUFFER_BYTES);
    logger.info('tinyasr_session_new succeeded', {
      sessionHandle,
      lang: activeLang,
      wasmBinary: activeWasmBinary,
    });
  } finally {
    exportsApi.tinyasr_dealloc(langsCstr.ptr, langsCstr.len);
    exportsApi.tinyasr_dealloc(startLangCstr.ptr, startLangCstr.len);
  }
}

function terminateHelpers() {
  for (const w of helperWorkers) {
    try {
      w.terminate();
    } catch {
      // Ignore terminate errors
    }
  }
  helperWorkers = [];
  helperCount = 0;
  if (helperBlobUrl && typeof URL?.revokeObjectURL === 'function') {
    URL.revokeObjectURL(helperBlobUrl);
  }
  helperBlobUrl = null;
}

async function loadWasmInstance(url, variant) {
  terminateHelpers();
  const wasmResp = await fetch(url);
  if (!wasmResp.ok) {
    throw new Error(`Failed to fetch ${url} (${wasmResp.status})`);
  }
  const wasmBytes = await wasmResp.arrayBuffer();
  validateAssetResponse(url, wasmResp, new Uint8Array(wasmBytes));

  let sharedMem = null;
  let ctl = null;
  let imports;
  if (variant === 'mt') {
    sharedMem = new WebAssembly.Memory({ initial: 1024, maximum: 16384, shared: true });
    ctl = new Int32Array(new SharedArrayBuffer(64));
    imports = {
      env: {
        memory: sharedMem,
        now: () => performance.now() / 1000,
        parallel_for: (n, task, ctx) => {
          ctl[1] = n;
          ctl[4] = task;
          ctl[5] = ctx;
          Atomics.store(ctl, 2, 0);
          Atomics.store(ctl, 3, 0);
          Atomics.add(ctl, 0, 1);
          Atomics.notify(ctl, 0);
          for (;;) {
            const i = Atomics.add(ctl, 2, 1);
            if (i >= n) break;
            exportsApi.tinyasr_web_task(task, ctx, i);
          }
          for (let k = 0; Atomics.load(ctl, 3) < helperCount; k += 1) {
            if (k > HELPER_SPIN) Atomics.wait(ctl, 3, Atomics.load(ctl, 3), 1);
          }
        },
      },
    };
  } else {
    imports = {
      env: { now: () => performance.now() / 1000 },
    };
  }

  const desiredThreads =
    variant === 'mt' && self.crossOriginIsolated
      ? Math.min(4, navigator?.hardwareConcurrency || 1)
      : 1;
  const canSpawnHelpers =
    desiredThreads > 1 &&
    typeof Worker === 'function' &&
    typeof WebAssembly.compile === 'function' &&
    typeof URL?.createObjectURL === 'function';

  let compiledMod = null;
  let instance;
  if (canSpawnHelpers) {
    compiledMod = await WebAssembly.compile(wasmBytes);
    const res = await WebAssembly.instantiate(compiledMod, imports);
    instance = res.instance || res;
  } else {
    const res = await WebAssembly.instantiate(wasmBytes, imports);
    instance = res.instance;
  }

  exportsApi = instance.exports;
  wasmMemory = exportsApi.memory || sharedMem;
  activeWasmBinary = url.split('/').pop() || url;

  if (exportsApi.__wasm_init_tls && exportsApi.__tls_size) {
    const tlsSize = Number(exportsApi.__tls_size.value ?? exportsApi.__tls_size);
    if (tlsSize > 0) {
      const tlsPtr = exportsApi.tinyasr_alloc(tlsSize);
      exportsApi.__wasm_init_tls(tlsPtr);
    }
  }

  if (canSpawnHelpers && compiledMod && exportsApi.__tls_size) {
    const want = desiredThreads - 1;
    const tlsSize = Number(exportsApi.__tls_size.value ?? exportsApi.__tls_size);
    helperBlobUrl = URL.createObjectURL(
      new Blob([HELPER_WORKER_CODE], { type: 'text/javascript' })
    );
    await new Promise((resolve) => {
      let up = 0;
      for (let k = 0; k < want; k += 1) {
        const w = new Worker(helperBlobUrl);
        helperWorkers.push(w);
        const sp = exportsApi.tinyasr_alloc(HELPER_STACK_BYTES);
        const tls = exportsApi.tinyasr_alloc(tlsSize);
        w.onmessage = () => {
          up += 1;
          if (up === want) {
            helperCount = want;
            resolve();
          }
        };
        w.postMessage({
          mod: compiledMod,
          memory: wasmMemory,
          ctl,
          top: sp + HELPER_STACK_BYTES,
          tls,
          spin: HELPER_SPIN,
        });
      }
    });
  } else if (variant === 'mt' && exportsApi.tinyasr_set_threads) {
    exportsApi.tinyasr_set_threads(1);
  }

  logger.info('WASM module instantiated', {
    wasmBinary: activeWasmBinary,
    variant,
    threads: helperCount + 1,
    crossOriginIsolated: Boolean(self.crossOriginIsolated),
  });
}

export async function initEngine({
  lang = 'uk',
  modelUrl = DEFAULT_MODEL_URL,
  vadUrl = DEFAULT_VAD_URL,
  wasmUrl,
  endpointSilenceMs: customEndpointMs,
}) {
  logger.info('INIT start', { lang, modelUrl, vadUrl, wasmUrl });
  finishActiveSession();
  committedWords = [];
  committedText = '';
  hasPendingPartial = false;
  silenceAccumMs = 0;
  sessionAudioMs = 0;
  sessionAudioOffsetMs = 0;
  endpointSilenceMs = Number(customEndpointMs) > 0 ? Number(customEndpointMs) : DEFAULT_ENDPOINT_SILENCE_MS;
  chunkCounter = 0;
  lastChunkLogMs = 0;
  totalAudioMs = 0;
  totalInferMs = 0;

  let loadedBytes = 0;
  let totalHint = ESTIMATED_TOTAL_BYTES;
  self.postMessage({ type: 'MODEL_PROGRESS', percent: 0, cached: false });

  const onProgressChunk = (delta, fileTotal) => {
    loadedBytes += delta;
    if (fileTotal > 0 && totalHint === ESTIMATED_TOTAL_BYTES) {
      totalHint = Math.max(fileTotal, ESTIMATED_TOTAL_BYTES);
    }
    const percent = Math.min(99, Math.round((loadedBytes / totalHint) * 100));
    self.postMessage({ type: 'MODEL_PROGRESS', percent, cached: false });
  };

  const [modelRes, vadRes] = await Promise.all([
    fetchCachedBytes(modelUrl, onProgressChunk),
    fetchCachedBytes(vadUrl, onProgressChunk),
  ]);

  const allCached = modelRes.cached && vadRes.cached;
  self.postMessage({ type: 'MODEL_PROGRESS', percent: 100, cached: allCached });

  const wasmConfig = resolveWasmConfig(wasmUrl);
  logger.info('WASM variant selected', {
    variant: wasmConfig.variant,
    url: wasmConfig.url,
    crossOriginIsolated: Boolean(self.crossOriginIsolated),
    hardwareConcurrency: navigator?.hardwareConcurrency || 1,
  });

  try {
    await loadWasmInstance(wasmConfig.url, wasmConfig.variant);
  } catch (err) {
    if (wasmConfig.variant === 'mt' && !wasmConfig.explicit) {
      logger.warn('MT WASM instantiation failed, falling back to ST', { err });
      await loadWasmInstance(DEFAULT_ST_WASM_URL, 'st');
    } else {
      throw err;
    }
  }

  logger.error("DEBUG_BYTES", { modelLen: modelRes.bytes.length, modelHead: Array.from(modelRes.bytes.slice(0, 8)), vadLen: vadRes.bytes.length, vadHead: Array.from(vadRes.bytes.slice(0, 8)) });
  const modelAlloc = allocBytes(modelRes.bytes);
  const vadAlloc = allocBytes(vadRes.bytes);
  const errPtr = exportsApi.tinyasr_alloc(256);
  new Uint8Array(getMemoryBuffer(), errPtr, 256).fill(0);

  try {
    modelHandle = exportsApi.tinyasr_load(
      modelAlloc.ptr,
      modelAlloc.len,
      vadAlloc.ptr,
      vadAlloc.len,
      errPtr,
      256
    );
    if (!modelHandle) {
      throw new Error(readCString(errPtr) || 'tinyasr_load failed');
    }
    if (
      helperCount > 0 &&
      exportsApi.tinyasr_set_parallel_for &&
      exportsApi.tinyasr_web_parallel_for
    ) {
      exportsApi.tinyasr_set_parallel_for(
        modelHandle,
        exportsApi.tinyasr_web_parallel_for(),
        0,
        helperCount + 1
      );
    }
    logger.info('tinyasr_load succeeded', {
      modelHandle,
      threads: helperCount + 1,
      modelBytes: modelRes.bytes.byteLength,
      vadBytes: vadRes.bytes.byteLength,
    });
  } finally {
    exportsApi.tinyasr_dealloc(modelAlloc.ptr, modelAlloc.len);
    exportsApi.tinyasr_dealloc(vadAlloc.ptr, vadAlloc.len);
    exportsApi.tinyasr_dealloc(errPtr, 256);
  }

  currentActiveLang = String(lang).startsWith('uk') ? 'uk' : 'en';
  openAsrSession(currentActiveLang);

  self.postMessage({ type: 'MODEL_READY' });
}

self.onmessage = async (event) => {
  const payload = event.data || {};

  if (payload.type === 'INIT') {
    try {
      await initEngine(payload);
    } catch (err) {
      logger.error('ENGINE_ERROR', { phase: 'INIT', err });
      self.postMessage({
        type: 'ENGINE_ERROR',
        message: err?.message || 'Failed to initialize tinyasr worker',
      });
    }
    return;
  }

  if (payload.type === 'AUDIO_CHUNK') {
    if (!exportsApi || !sessionHandle) return;
    try {
      const samples = normalizePcmChunk(payload.samples);
      chunkCounter += 1;
      const audioMs = (samples.length / 16000) * 1000;
      sessionAudioMs += audioMs;
      const rms = computeChunkRms(samples);
      const pcmPtr = ensurePcmBuffer(samples.byteLength);
      new Float32Array(getMemoryBuffer(), pcmPtr, samples.length).set(samples);

      const t0 = performance.now();
      const jsonPtr = exportsApi.tinyasr_session_push(sessionHandle, pcmPtr, samples.length);
      const inferMs = performance.now() - t0;

      totalAudioMs += audioMs;
      totalInferMs += inferMs;
      const now = performance.now();
      if (lastChunkLogMs === 0 || now - lastChunkLogMs >= CHUNK_LOG_INTERVAL_MS) {
        lastChunkLogMs = now;
        const rtf = audioMs > 0 ? inferMs / audioMs : 0;
        const avgRtf = totalAudioMs > 0 ? totalInferMs / totalAudioMs : 0;
        logger.debug('Audio chunk stats', {
          chunkCount: chunkCounter,
          sampleCount: samples.length,
          sampleRate: 16000,
          rms: Number(rms.toFixed(5)),
          wasmBinary: activeWasmBinary,
          crossOriginIsolated: Boolean(self.crossOriginIsolated),
          inferMs: Number(inferMs.toFixed(2)),
          rtf: Number(rtf.toFixed(4)),
          avgRtf: Number(avgRtf.toFixed(4)),
        });
      }

      if (jsonPtr) {
        const rawJson = readCString(jsonPtr);
        if (rawJson && rawJson !== '[]') {
          logger.debug('tinyasr_session_push raw events', { json: rawJson });
          emitEventsFromJson(rawJson);
        }
      }

      if (rms >= ENDPOINT_SILENCE_RMS) {
        silenceAccumMs = 0;
      } else if (hasPendingPartial) {
        silenceAccumMs += audioMs;
        if (silenceAccumMs >= endpointSilenceMs) {
          logger.debug('Endpointing flush after post-speech silence', {
            silenceMs: Math.round(silenceAccumMs),
            endpointSilenceMs,
          });
          finishActiveSession({ keepPcmBuffer: true });
          sessionAudioOffsetMs += Math.round(sessionAudioMs);
          sessionAudioMs = 0;
          silenceAccumMs = 0;
          hasPendingPartial = false;
          openAsrSession(currentActiveLang);
        }
      }
    } catch (err) {
      logger.error('ENGINE_ERROR', { phase: 'AUDIO_CHUNK', err });
      self.postMessage({
        type: 'ENGINE_ERROR',
        message: err?.message || 'Failed to process audio chunk',
      });
    }
    return;
  }

  if (payload.type === 'FINISH' || payload.type === 'RESET') {
    finishActiveSession();
    committedWords = [];
    committedText = '';
    hasPendingPartial = false;
    silenceAccumMs = 0;
    sessionAudioMs = 0;
    sessionAudioOffsetMs = 0;
  }
};
