# StagePulse

**Zero-cloud-latency presentation timer & live speech telemetry.**  
Client-side Rust/WASM neural ASR (`dkaraush/tinyasr`) + Silero VAD running off the main thread via `AudioWorklet`, Web Workers, and `SharedArrayBuffer` (`Atomics` MT-WASM with ST fallback).

---

## Architecture

```text
Mic ──▶ AudioWorklet (16kHz + AGC) ──▶ WASM Worker (Silero VAD + tinyasr) ──▶ Telemetry UI
                                              │                                     │
                                      SharedArrayBuffer                    useSyncExternalStore
                                     (MT-WASM / ST fallback)              + rAF Direct-DOM 60fps
```

- **Off-Main-Thread ASR**: 5-tap anti-aliased 16kHz resampling, AGC soft-limiter, and `tinyasr-mt.wasm` (`COOP`/`COEP` isolated) with `CacheStorage` model persistence.
- **60fps Telemetry**: `rAF` direct-DOM timer & 24-bar audio meter, 120ms coalesced `speechStore` slices, and `React.memo` append-only transcript blocks.
- **Deterministic Speech Metrics**: Live WPM (session + 15s rolling), word-timestamp pause detection (`≥1.5s`), and **PRO** custom filler-word dictionary (`GET/PUT /api/v1/filler-dictionary`).
- **Backend**: FastAPI + async SQLAlchemy 2.0 (`aiosqlite` dev / `asyncpg` Neon Postgres prod) + Alembic + 3-spin Milestone PRO unlock.

---

## Quickstart

```bash
# Development (Postgres + one-shot Alembic migrate + hot-reload backend & Vite)
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build

# Production (hardened multi-stage backend + Nginx with COOP/COEP & gzip)
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Verification

```bash
# Frontend (Vitest + V8 coverage: 20 files, 89 tests, 100% statements/lines)
npm --prefix frontend run test:coverage

# Backend (Pytest + Ruff + Pyrefly: 100 tests)
backend/.venv/bin/pytest backend/tests --tb=short -q
```

---

## License & Attribution

Licensed under **GPL-3.0** (see [LICENSE](LICENSE)).  
Powered by [`dkaraush/tinyasr`](https://github.com/dkaraush/tinyasr) (Rust/WASM neural speech recognition & Silero VAD).
