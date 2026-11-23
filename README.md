# StagePulse

**Real-time public speaking rehearsal with zero blind spots.**

[![Live Demo](https://img.shields.io/badge/demo-stagepulse.pages.dev-10B981?style=flat-square)](https://stagepulse.pages.dev)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-61DAFB?style=flat-square)](#tech-stack)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20%2B%20SQLAlchemy%202.0-009688?style=flat-square)](#tech-stack)
[![Edge AI](https://img.shields.io/badge/edge%20AI-Rust%20%2F%20WASM%20(tinyasr)-DEA584?style=flat-square)](#system-architecture--engineering-deep-dive)

StagePulse is a high-precision presentation timer and live speech telemetry studio built for founders, engineers, and speakers preparing for pitches, thesis defenses, and keynotes. Instead of guessing whether you are rushing, pausing too long, or leaning on crutch words, StagePulse measures your delivery live in the browser with zero cloud latency. By running neural speech recognition and voice activity detection locally in WebAssembly, feedback is instantaneous and raw audio never leaves your device.

---

## Product & Features

- **Real-Time WPM & Pace Control:** Track both session-average WPM and a 15-second rolling WPM window live as you speak, with extreme inter-word idle gaps (`>15s`) capped so setup pauses never skew your speaking rate. A `requestAnimationFrame`-driven timer and 24-bar audio meter keep the UI locked at 60fps.
- **Live Speech Transcription (UA / EN):** Instant bilingual (`uk` / `en`) speech-to-text feedback right during rehearsal, rendered in append-only `React.memo` blocks (`60` words per block) with smart bottom-anchored auto-scroll and one-click copy/export (`.txt`).
- **Filler Word Detection, Pause Tracking & Session Analytics:**
  - **Deterministic Pause Telemetry:** Long pauses (`≥1.5s`) are computed strictly from committed ASR word timestamps (`startMs` / `endMs`), eliminating false triggers from background noise or fan hum.
  - **PRO Custom Filler Dictionary:** PRO users define their own target words and multi-word phrases (`GET`/`PUT /api/v1/filler-dictionary`, up to 100 entries) for live highlighting and post-session breakdowns—zero hardcoded developer lists.
- **Milestone Progression & UX Polish:** A 3-reel Pace Mastery milestone unlocker (`SlotMachineModal`), Web Audio API synthesized feedback, and a mobile-first dark UI (`360px–430px` responsive sliders, `44px+` touch targets, `tabular-nums`) turn dry rehearsal into an engaging loop.

---

## System Architecture & Engineering Deep Dive

```text
┌─────────────┐     ┌──────────────────────────┐     ┌─────────────────────────────┐
│ Microphone  │────▶│ AudioWorklet (16kHz Mono) │────▶│ Web Worker (tinyasr WASM)   │
│ (48kHz Raw) │     │ 5-tap LPF + AGC Limiter  │     │ Silero VAD + MT/ST Inference│
└─────────────┘     └──────────────────────────┘     └──────────────┬──────────────┘
                                                                    │ 120ms Coalesced
                                                                    ▼
┌─────────────┐     ┌──────────────────────────┐     ┌─────────────────────────────┐
│ PostgreSQL  │◀───▶│ FastAPI (Async SQLAlc.)  │◀───▶│ speechStore + rAF DOM UI    │
│ users /     │     │ Auth, Sessions,          │     │ useSyncExternalStore Slices │
│presentations│     │ Filler Dict, Milestones  │     │ 60fps Timer & Transcript    │
└─────────────┘     └──────────────────────────┘     └─────────────────────────────┘
```

### Client-Side Edge AI (Rust + WebAssembly)
- **Audio Pipeline:** `micCapture.js` captures microphone input at native hardware rate, downsamples to `16000 Hz` mono via an `AudioWorklet` (5-tap anti-aliasing low-pass filter + AGC soft-limiter), and streams `~40–60ms` chunks over Transferable `ArrayBuffer`s.
- **WASM Execution:** `asr.worker.js` runs `dkaraush/tinyasr` + Silero VAD off the main thread. When `COOP`/`COEP` headers enable `crossOriginIsolated === true`, it loads `tinyasr-mt.wasm` backed by `SharedArrayBuffer` and `Atomics` threadpools (automatically falling back to single-threaded `tinyasr.wasm` otherwise). Models are cached in `CacheStorage` for instant subsequent starts.
- **Architectural Payoff:** Zero network round-trip for live captions, **100% audio privacy** (raw voice never leaves the browser), and near-zero server inference cost at scale.

### Backend & Persistence (PostgreSQL)
- **Async Data Layer:** FastAPI + async SQLAlchemy 2.0 (`asyncpg` for PostgreSQL / Neon in production, `aiosqlite` for local zero-config dev) with Alembic migrations.
- **Core Tables:** `users` (Argon2id auth, `is_pro`, `custom_filler_words` JSONB, milestone progression) and `presentations` (persisted session duration, WPM, pause counts, filler breakdowns, and transcripts).
- **Client-Server Sync:** Only lightweight JSON telemetry and custom dictionary updates cross the network over JWT-authenticated REST endpoints.

---

## Tech Stack

| Layer | Technology | Why It Was Chosen |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite, Tailwind CSS | `useSyncExternalStore` atomic slices + `rAF` direct-DOM updates prevent re-render jank during 1,500+ word sessions. |
| **Audio / ML Core** | `dkaraush/tinyasr` (Rust/WASM), Silero VAD, `AudioWorklet` | Sub-frame local inference with `SharedArrayBuffer` multi-threading and zero server GPU cost. |
| **Backend** | FastAPI, Pydantic v2, `pwdlib` (Argon2id) | High-throughput async Python 3.14+ API with strict schema validation and modern password hashing. |
| **Database** | PostgreSQL (Neon), SQLAlchemy 2.0, Alembic | Reliable relational + `JSONB` storage for speech telemetry and user-defined filler dictionaries. |
| **Infrastructure** | Docker Compose (`dev`/`prod`), Nginx, Cloudflare Pages | Isolated `COOP`/`COEP` headers for `SharedArrayBuffer`, one-shot dev migrations, and gzip/immutable asset caching. |

---

## Getting Started (Local Development)

> [!IMPORTANT]
> Prebuilt `tinyasr` WASM binaries and models are already bundled in `frontend/public/wasm/` and `frontend/public/models/`—no local Rust/Cargo compilation is required.

### Option A: Docker Compose (Recommended)
```bash
cp .env.example .env
# Starts Postgres 17, runs one-shot Alembic migrations, and boots hot-reload backend + Vite
docker compose -f docker-compose.dev.yml up --build
```

### Option B: Manual Local Setup
```bash
# 1. Backend (Python 3.14+ / uv or venv)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 2. Frontend (Node 20+)
cd ../frontend
npm install
npm run dev
```

> [!TIP]
> Run `npm --prefix frontend run test:coverage` (Vitest) and `backend/.venv/bin/pytest backend/tests --tb=short -q` (Pytest) to verify both suites.

---

## Roadmap

- [ ] **Pitch Deck Slide Sync:** Optional timer cues tied to slide transitions.
- [ ] **Historical Pace Trends:** Multi-session WPM & pause-reduction charts on the Dashboard.
- [ ] **Custom Target Pace Presets:** Saveable WPM bands for keynotes, investor pitches, and academic defenses.
- [ ] **Offline PWA Mode:** Full offline rehearsal with background sync when connectivity returns.

---

## License & Attribution

Licensed under **GPL-3.0** — see [LICENSE](LICENSE).  
Client-side neural ASR & Silero VAD powered by [`dkaraush/tinyasr`](https://github.com/dkaraush/tinyasr).
