const CACHE_NAME = 'tinyasr-models-v1';
const DEFAULT_MODEL_URL = '/models/en-ru-uk.tzf.gz';
const DEFAULT_VAD_URL = '/models/silero_vad.onnx.gz';
const ESTIMATED_TOTAL_BYTES = 33_800_000;

let exportsApi = null;
let modelHandle = 0;
let sessionHandle = 0;
let committedWords = [];
let committedText = '';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function resolveWasmUrl(overrideUrl) {
  if (overrideUrl) return overrideUrl;
  const mtSupported =
    Boolean(self.crossOriginIsolated) && (navigator?.hardwareConcurrency || 1) > 1;
  return mtSupported ? '/wasm/tinyasr-mt.wasm' : '/wasm/tinyasr.wasm';
}

function allocBytes(bytes) {
  const ptr = exportsApi.tinyasr_alloc(bytes.length);
  new Uint8Array(exportsApi.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function allocCString(str) {
  const encoded = textEncoder.encode(`${str}\0`);
  return allocBytes(encoded);
}

function readCString(ptr) {
  if (!ptr) return '';
  const mem = new Uint8Array(exportsApi.memory.buffer);
  let end = ptr;
  while (end < mem.length && mem[end] !== 0) {
    end += 1;
  }
  return textDecoder.decode(mem.subarray(ptr, end));
}

async function maybeDecompressGzip(uint8) {
  if (uint8.length >= 2 && uint8[0] === 0x1f && uint8[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([uint8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  return uint8;
}

async function fetchCachedBytes(url, onProgressChunk) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResp = await cache.match(url);
  if (cachedResp) {
    const buf = await cachedResp.arrayBuffer();
    return { bytes: await maybeDecompressGzip(new Uint8Array(buf)), cached: true };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
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

  await cache.put(url, responseClone);
  return { bytes: await maybeDecompressGzip(compressed), cached: false };
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

function emitEventsFromJson(jsonText) {
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
        startMs: Math.round((w.start ?? 0) * 1000),
        endMs: Math.round((w.end ?? 0) * 1000),
        join: Boolean(w.join),
      }));
      committedWords = committedWords.concat(mapped);
      committedText = joinCommittedWords(committedWords);
      self.postMessage({
        type: 'TRANSCRIPT_UPDATE',
        words: [...committedWords],
        fullText: committedText,
        isFinal: true,
      });
    } else if (ev.type === 'partial' || 'open' in ev || 'tail' in ev) {
      const partialText = [committedText, ev.open || '', ev.tail || '']
        .filter(Boolean)
        .join(' ')
        .trim();
      self.postMessage({
        type: 'TRANSCRIPT_UPDATE',
        words: [...committedWords],
        fullText: partialText,
        isFinal: false,
      });
    }
  }
}

function finishActiveSession() {
  if (!exportsApi || !sessionHandle) return;
  try {
    const finalPtr = exportsApi.tinyasr_session_finish(sessionHandle);
    if (finalPtr) {
      emitEventsFromJson(readCString(finalPtr));
    }
  } finally {
    exportsApi.tinyasr_session_free(sessionHandle);
    sessionHandle = 0;
  }
}

async function initEngine({
  lang = 'uk',
  modelUrl = DEFAULT_MODEL_URL,
  vadUrl = DEFAULT_VAD_URL,
  wasmUrl,
}) {
  finishActiveSession();
  committedWords = [];
  committedText = '';

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

  const resolvedWasm = resolveWasmUrl(wasmUrl);
  const wasmResp = await fetch(resolvedWasm);
  if (!wasmResp.ok) {
    throw new Error(`Failed to fetch ${resolvedWasm} (${wasmResp.status})`);
  }
  const wasmBytes = await wasmResp.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    env: { now: () => performance.now() / 1000 },
  });
  exportsApi = instance.exports;

  const modelAlloc = allocBytes(modelRes.bytes);
  const vadAlloc = allocBytes(vadRes.bytes);
  const errPtr = exportsApi.tinyasr_alloc(256);
  new Uint8Array(exportsApi.memory.buffer, errPtr, 256).fill(0);

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
  } finally {
    exportsApi.tinyasr_dealloc(modelAlloc.ptr, modelAlloc.len);
    exportsApi.tinyasr_dealloc(vadAlloc.ptr, vadAlloc.len);
    exportsApi.tinyasr_dealloc(errPtr, 256);
  }

  const isUk = String(lang).startsWith('uk');
  const langsCstr = allocCString(isUk ? 'uk,en' : 'en,uk');
  const startLangCstr = allocCString(isUk ? 'uk' : 'en');

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
  } finally {
    exportsApi.tinyasr_dealloc(langsCstr.ptr, langsCstr.len);
    exportsApi.tinyasr_dealloc(startLangCstr.ptr, startLangCstr.len);
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
    if (!exportsApi || !sessionHandle) return;
    const samples =
      payload.samples instanceof Float32Array
        ? payload.samples
        : new Float32Array(payload.samples);
    const pcmPtr = exportsApi.tinyasr_alloc(samples.byteLength);
    try {
      new Float32Array(exportsApi.memory.buffer, pcmPtr, samples.length).set(samples);
      const jsonPtr = exportsApi.tinyasr_session_push(sessionHandle, pcmPtr, samples.length);
      if (jsonPtr) {
        emitEventsFromJson(readCString(jsonPtr));
      }
    } finally {
      exportsApi.tinyasr_dealloc(pcmPtr, samples.byteLength);
    }
    return;
  }

  if (payload.type === 'FINISH' || payload.type === 'RESET') {
    finishActiveSession();
    committedWords = [];
    committedText = '';
  }
};
