import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('workers/asr.worker.js', () => {
  let postedMessages;
  let origSelf;
  let origFetch;
  let origCaches;
  let origWebAssembly;
  let origDecompressionStream;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    postedMessages = [];
    origSelf = globalThis.self;
    origFetch = globalThis.fetch;
    origCaches = globalThis.caches;
    origWebAssembly = globalThis.WebAssembly;
    origDecompressionStream = globalThis.DecompressionStream;

    globalThis.self = {
      crossOriginIsolated: false,
      onmessage: null,
      postMessage: vi.fn((msg) => postedMessages.push(msg)),
    };
  });

  afterEach(() => {
    globalThis.self = origSelf;
    globalThis.fetch = origFetch;
    Object.defineProperty(globalThis, 'caches', { value: origCaches, configurable: true });
    globalThis.WebAssembly = origWebAssembly;
    globalThis.DecompressionStream = origDecompressionStream;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function makeResponse(bytes, { ok = true, status = 200, headers = {} } = {}) {
    const u8 = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
    const hdrMap = new Map(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
    );
    const resp = {
      ok,
      status,
      headers: {
        get: (name) => hdrMap.get(name.toLowerCase()) ?? null,
      },
      arrayBuffer: async () => u8.slice().buffer,
      clone: () => makeResponse(u8, { ok, status, headers }),
    };
    return resp;
  }

  it('rejects HTML 404 SPA fallbacks, empty buffers, and truncated caches, auto-evicting and re-fetching', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const store = new Map();
    const deleteSpy = vi.fn(async (k) => store.delete(k));
    const putSpy = vi.fn(async (k, v) => store.set(k, v));
    Object.defineProperty(globalThis, 'caches', {
      value: {
        open: vi.fn(async () => ({
          match: async (k) => store.get(k),
          put: putSpy,
          delete: deleteSpy,
        })),
      },
      configurable: true,
    });

    const worker = await import('./asr.worker.js');

    // 1. Poisoned cache with HTML SPA fallback -> auto-evicts and re-fetches valid binary
    store.set(
      '/models/test.bin',
      makeResponse('<!DOCTYPE html><html><body>SPA</body></html>', {
        headers: { 'content-type': 'text/html' },
      })
    );
    const validModelBytes = new Uint8Array([1, 2, 3, 4, 5]);
    globalThis.fetch = vi.fn(async () =>
      makeResponse(validModelBytes, {
        headers: { 'content-type': 'application/octet-stream', 'content-length': '5' },
      })
    );

    const res1 = await worker.fetchCachedBytes('/models/test.bin', vi.fn());
    expect(deleteSpy).toHaveBeenCalledWith('/models/test.bin');
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(res1.cached).toBe(false);
    expect(Array.from(res1.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(warnSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    // 2. Poisoned cache with truncated buffer -> auto-evicts
    store.set(
      '/models/trunc.bin',
      makeResponse(new Uint8Array([1, 2]), { headers: { 'content-length': '100' } })
    );
    globalThis.fetch = vi.fn(async () =>
      makeResponse(new Uint8Array([9, 8, 7]), { headers: { 'content-length': '3' } })
    );
    const res2 = await worker.fetchCachedBytes('/models/trunc.bin', vi.fn());
    expect(deleteSpy).toHaveBeenCalledWith('/models/trunc.bin');
    expect(res2.cached).toBe(false);

    // 3. Poisoned cache with empty buffer -> auto-evicts
    store.set('/models/empty.bin', makeResponse(new Uint8Array([])));
    const res3 = await worker.fetchCachedBytes('/models/empty.bin', vi.fn());
    expect(deleteSpy).toHaveBeenCalledWith('/models/empty.bin');
    expect(res3.cached).toBe(false);

    // 4. Network fetch returning HTML fallback throws and does not cache
    const putBefore = putSpy.mock.calls.length;
    globalThis.fetch = vi.fn(async () =>
      makeResponse('<html><body>Not Found</body></html>', { status: 200 })
    );
    await expect(worker.fetchCachedBytes('/models/bad.bin', vi.fn())).rejects.toThrow(
      /HTML fallback/i
    );
    expect(putSpy.mock.calls.length).toBe(putBefore);

    // 5. Invalid WASM magic rejected
    expect(() =>
      worker.validateAssetResponse(
        '/wasm/tinyasr.wasm',
        makeResponse('not wasm'),
        new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
      )
    ).toThrow(/Invalid WASM/i);
  });

  it('normalizes PCM chunks strictly to [-1.0, 1.0] Float32Array and handles partial array/string events', async () => {
    const worker = await import('./asr.worker.js');

    const normalized = worker.normalizePcmChunk([1.75, -2.5, 0.25, Number.NaN, Infinity]);
    expect(normalized).toBeInstanceOf(Float32Array);
    expect(Array.from(normalized)).toEqual([1, -1, 0.25, 0, 0]);
    expect(() => worker.normalizePcmChunk(new Float32Array(0))).toThrow(/empty/i);

    // Empty partial arrays from real tinyasr should produce empty string, not "[object Object]"
    worker.emitEventsFromJson(JSON.stringify([{ type: 'partial', open: [], tail: [] }]));
    expect(postedMessages.at(-1)).toEqual({
      type: 'TRANSCRIPT_UPDATE',
      words: [],
      fullText: '',
      isFinal: false,
    });

    // Word-object partial arrays + commit
    worker.emitEventsFromJson(
      JSON.stringify([
        {
          type: 'partial',
          open: [{ text: 'hel' }, { text: 'lo', join: true }],
          tail: ['world'],
        },
      ])
    );
    expect(postedMessages.at(-1)).toEqual({
      type: 'TRANSCRIPT_UPDATE',
      words: [],
      fullText: 'hello world',
      isFinal: false,
    });
  });

  it('logs INIT, WASM mt/st selection + fallback, handles, throttled chunk stats, raw push JSON, and ENGINE_ERROR', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.self.crossOriginIsolated = true;
    globalThis.SharedArrayBuffer = ArrayBuffer;
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4, configurable: true });

    const store = new Map();
    Object.defineProperty(globalThis, 'caches', {
      value: {
        open: vi.fn(async () => ({
          match: async (k) => store.get(k),
          put: async (k, v) => store.set(k, v),
          delete: async (k) => store.delete(k),
        })),
      },
      configurable: true,
    });

    const wasmMagic = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const enc = new TextEncoder();
    const fakeMem = new ArrayBuffer(4 * 1024 * 1024);
    const memView = new Uint8Array(fakeMem);
    const pushJson = JSON.stringify([
      { type: 'commit', words: [{ text: 'hello', start: 0.1, end: 0.5 }] },
    ]);
    const pushJsonPtr = 512;
    memView.set(enc.encode(`${pushJson}\0`), pushJsonPtr);

    let allocOffset = 64;
    const mockExports = {
      memory: { buffer: fakeMem },
      tinyasr_alloc: vi.fn((len) => {
        const ptr = allocOffset;
        allocOffset += (len + 11) & ~3;
        return ptr;
      }),
      tinyasr_dealloc: vi.fn(),
      tinyasr_load: vi.fn(() => 101),
      tinyasr_clock: vi.fn(() => 123.4),
      tinyasr_session_new: vi.fn(() => 202),
      tinyasr_session_push: vi.fn(() => pushJsonPtr),
      tinyasr_session_finish: vi.fn(() => 0),
      tinyasr_session_free: vi.fn(),
    };

    // First call (MT) throws LinkError, second call (ST fallback) succeeds
    let wasmCalls = 0;
    globalThis.WebAssembly = {
      Memory: class {
        constructor() {
          this.buffer = fakeMem;
        }
      },
      instantiate: vi.fn(async () => {
        wasmCalls += 1;
        if (wasmCalls === 1) {
          throw new Error('MT shared memory unsupported');
        }
        return { instance: { exports: mockExports } };
      }),
    };

    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('.wasm')) {
        return makeResponse(wasmMagic, {
          headers: { 'content-type': 'application/wasm', 'content-length': '8' },
        });
      }
      return makeResponse(new Uint8Array([10, 20, 30]), {
        headers: { 'content-length': '3' },
      });
    });

    await import('./asr.worker.js');

    await globalThis.self.onmessage({
      data: { type: 'INIT', lang: 'en' },
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to ST'));
    expect(postedMessages.some((m) => m.type === 'MODEL_READY')).toBe(true);
    const logs = logSpy.mock.calls.map((c) => c[0]);
    expect(logs.some((l) => l.includes('tinyasr_load') && l.includes('101'))).toBe(true);
    expect(logs.some((l) => l.includes('tinyasr_session_new') && l.includes('202'))).toBe(true);
    expect(logs.some((l) => l.includes('"wasmBinary":"tinyasr.wasm"'))).toBe(true);

    // Verify strict single-language lock ('en' only, never 'en,uk')
    const [langsPtr, startLangPtr] = [
      mockExports.tinyasr_session_new.mock.calls[0][1],
      mockExports.tinyasr_session_new.mock.calls[0][2],
    ];
    const readStr = (p) => {
      let end = p;
      while (memView[end] !== 0) end += 1;
      return new TextDecoder().decode(memView.subarray(p, end));
    };
    expect(readStr(langsPtr)).toBe('en');
    expect(readStr(startLangPtr)).toBe('en');

    // Pre-allocated PCM buffer: pushing multiple <=1024-sample chunks must NOT call tinyasr_alloc again
    const allocCallsAfterInit = mockExports.tinyasr_alloc.mock.calls.length;
    await globalThis.self.onmessage({
      data: { type: 'AUDIO_CHUNK', samples: new Float32Array([1.5, -1.5, 0.2]) },
    });
    await globalThis.self.onmessage({
      data: { type: 'AUDIO_CHUNK', samples: new Float32Array([0.1, 0.2, 0.3]) },
    });
    expect(mockExports.tinyasr_alloc.mock.calls.length).toBe(allocCallsAfterInit);

    const lastPushPtr = mockExports.tinyasr_session_push.mock.calls.at(-1)[1];
    const pushedSlice = new Float32Array(fakeMem, lastPushPtr, 3);
    expect(Array.from(pushedSlice)).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.3, 5),
    ]);
    expect(postedMessages.some((m) => m.type === 'TRANSCRIPT_UPDATE' && m.fullText === 'hello')).toBe(
      true
    );
    expect(logSpy.mock.calls.some((c) => c[0].includes('tinyasr_session_push raw events'))).toBe(
      true
    );
    expect(logSpy.mock.calls.some((c) => c[0].includes('"rtf":'))).toBe(true);

    // Oversized chunk (>4096 bytes) resizes pre-allocated buffer cleanly
    await globalThis.self.onmessage({
      data: { type: 'AUDIO_CHUNK', samples: new Float32Array(1200).fill(0.05) },
    });
    expect(mockExports.tinyasr_alloc.mock.calls.length).toBe(allocCallsAfterInit + 1);

    // FINISH frees session and pre-allocated PCM buffer
    await globalThis.self.onmessage({ data: { type: 'FINISH' } });
    expect(mockExports.tinyasr_session_free).toHaveBeenCalledWith(202);

    // Trigger ENGINE_ERROR when tinyasr_load returns 0 and verify strict 'uk' language lock
    mockExports.tinyasr_load.mockReturnValueOnce(0);
    await globalThis.self.onmessage({
      data: { type: 'INIT', lang: 'uk-UA', wasmUrl: '/wasm/tinyasr.wasm' },
    });
    expect(errorSpy).toHaveBeenCalled();
    expect(postedMessages.some((m) => m.type === 'ENGINE_ERROR')).toBe(true);
  });

  it('spawns MT helper workers and calls tinyasr_set_parallel_for when crossOriginIsolated + Worker + compile exist', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    globalThis.self.crossOriginIsolated = true;
    globalThis.SharedArrayBuffer = ArrayBuffer;
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4, configurable: true });

    const store = new Map();
    Object.defineProperty(globalThis, 'caches', {
      value: {
        open: vi.fn(async () => ({
          match: async (k) => store.get(k),
          put: async (k, v) => store.set(k, v),
          delete: async (k) => store.delete(k),
        })),
      },
      configurable: true,
    });

    const wasmMagic = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('.wasm')) {
        return makeResponse(wasmMagic, { headers: { 'content-length': '8' } });
      }
      return makeResponse(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } });
    });

    const fakeMem = new ArrayBuffer(4 * 1024 * 1024);
    let offset = 64;
    const setParallelForSpy = vi.fn();
    const mockMtExports = {
      __tls_size: { value: 16 },
      __wasm_init_tls: vi.fn(),
      tinyasr_alloc: vi.fn((len) => {
        const ptr = offset;
        offset += (len + 11) & ~3;
        return ptr;
      }),
      tinyasr_dealloc: vi.fn(),
      tinyasr_load: vi.fn(() => 555),
      tinyasr_set_parallel_for: setParallelForSpy,
      tinyasr_web_parallel_for: vi.fn(() => 99),
      tinyasr_web_task: vi.fn(),
      tinyasr_clock: vi.fn(() => 1.0),
      tinyasr_session_new: vi.fn(() => 777),
      tinyasr_session_push: vi.fn(() => 0),
      tinyasr_session_finish: vi.fn(() => 0),
      tinyasr_session_free: vi.fn(),
    };

    const helpers = [];
    const origWorker = globalThis.Worker;
    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.terminate = vi.fn();
        this.postMessage = vi.fn(() => {
          queueMicrotask(() => this.onmessage?.({ data: 'up' }));
        });
        helpers.push(this);
      }
    };
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:helper');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    globalThis.WebAssembly = {
      Memory: class {
        constructor() {
          this.buffer = fakeMem;
        }
      },
      compile: vi.fn(async () => ({ compiled: true })),
      instantiate: vi.fn(async () => ({ instance: { exports: mockMtExports } })),
    };

    await import('./asr.worker.js');
    await globalThis.self.onmessage({ data: { type: 'INIT', lang: 'uk' } });

    expect(helpers).toHaveLength(3); // min(4, 4) - 1 = 3 helpers
    expect(setParallelForSpy).toHaveBeenCalledWith(555, 99, 0, 4);
    expect(
      logSpy.mock.calls.some(
        (c) => c[0].includes('"wasmBinary":"tinyasr-mt.wasm"') && c[0].includes('"threads":4')
      )
    ).toBe(true);

    await globalThis.self.onmessage({ data: { type: 'FINISH' } });
    globalThis.Worker = origWorker;
    createUrlSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });

  it('tightens endpointing by flushing pending partials after post-speech silence (~550ms) and preserving monotonic timestamps', async () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const store = new Map();
    Object.defineProperty(globalThis, 'caches', {
      value: {
        open: vi.fn(async () => ({
          match: async (k) => store.get(k),
          put: async (k, v) => store.set(k, v),
          delete: async (k) => store.delete(k),
        })),
      },
      configurable: true,
    });

    const wasmMagic = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('.wasm')) {
        return makeResponse(wasmMagic, { headers: { 'content-length': '8' } });
      }
      return makeResponse(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } });
    });

    const fakeMem = new ArrayBuffer(65536);
    const memView = new Uint8Array(fakeMem);
    const enc = new TextEncoder();
    const partialPtr = 4096;
    const commitPtr = 8192;
    const emptyPtr = 12288;
    memView.set(enc.encode(`${JSON.stringify([{ type: 'partial', open: ['привіт'], tail: [] }])}\0`), partialPtr);
    memView.set(
      enc.encode(`${JSON.stringify([{ type: 'commit', words: [{ text: 'привіт', start: 0.1, end: 0.4 }] }])}\0`),
      commitPtr
    );
    memView.set(enc.encode('[]\0'), emptyPtr);

    let offset = 16384;
    let pushCall = 0;
    const mockExports = {
      memory: { buffer: fakeMem },
      tinyasr_alloc: vi.fn((len) => {
        const ptr = offset;
        offset += (len + 11) & ~3;
        return ptr;
      }),
      tinyasr_dealloc: vi.fn(),
      tinyasr_load: vi.fn(() => 101),
      tinyasr_clock: vi.fn(() => 10),
      tinyasr_session_new: vi.fn(() => 202),
      tinyasr_session_push: vi.fn(() => {
        pushCall += 1;
        return pushCall === 1 ? partialPtr : emptyPtr;
      }),
      tinyasr_session_finish: vi.fn(() => commitPtr),
      tinyasr_session_free: vi.fn(),
    };
    globalThis.WebAssembly = {
      instantiate: vi.fn(async () => ({ instance: { exports: mockExports } })),
    };

    await import('./asr.worker.js');
    await globalThis.self.onmessage({
      data: { type: 'INIT', lang: 'uk', wasmUrl: '/wasm/tinyasr.wasm', endpointSilenceMs: 550 },
    });

    // Chunk 1: speech (640 samples = 40ms, high RMS) -> emits pending partial
    await globalThis.self.onmessage({
      data: { type: 'AUDIO_CHUNK', samples: new Float32Array(640).fill(0.2) },
    });
    expect(postedMessages.at(-1)).toMatchObject({ type: 'TRANSCRIPT_UPDATE', fullText: 'привіт', isFinal: false });

    // 15 silent chunks (15 * 40ms = 600ms >= 550ms) -> triggers endpointing flush & seamless session restart
    for (let i = 0; i < 15; i += 1) {
      await globalThis.self.onmessage({
        data: { type: 'AUDIO_CHUNK', samples: new Float32Array(640).fill(0.0001) },
      });
    }

    expect(mockExports.tinyasr_session_finish).toHaveBeenCalledTimes(1);
    expect(mockExports.tinyasr_session_new).toHaveBeenCalledTimes(2);
    expect(postedMessages.some((m) => m.type === 'TRANSCRIPT_UPDATE' && m.isFinal === true && m.fullText === 'привіт')).toBe(true);
    expect(logSpy.mock.calls.some((c) => c[0].includes('Endpointing flush'))).toBe(true);
  });
});
