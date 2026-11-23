# StagePulse

**Enterprise-grade, zero-latency speech telemetry and presentation rehearsal platform.**

[![Production](https://img.shields.io/badge/app-stagepulse.pages.dev-10B981?style=flat-square)](https://stagepulse.pages.dev)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square)](LICENSE)
[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-61DAFB?style=flat-square)](#technology-stack)
[![Backend](https://img.shields.io/badge/backend-FastAPI%20%2B%20SQLAlchemy%202.0-009688?style=flat-square)](#technology-stack)
[![Edge AI](https://img.shields.io/badge/edge%20AI-Rust%20%2F%20WASM%20(tinyasr)-DEA584?style=flat-square)](#client-side-edge-ai-pipeline)

StagePulse enables executives, founders, and technical presenters to rehearse high-stakes keynotes, investor pitches, thesis defenses, and briefings with real-time delivery telemetry. By executing neural automatic speech recognition (ASR) and voice activity detection (VAD) directly on the client via WebAssembly, StagePulse delivers sub-second pacing feedback with **zero server-side audio ingestion**, ensuring strict data privacy and predictable infrastructure costs at scale.

---

## Table of Contents

- [Key Capabilities](#key-capabilities)
- [System Architecture](#system-architecture)
- [Client-Side Edge AI Pipeline](#client-side-edge-ai-pipeline)
- [Frontend Performance Architecture](#frontend-performance-architecture)
- [Backend & Database Schema](#backend--database-schema)
- [API Reference](#api-reference)
- [Security & Privacy Posture](#security--privacy-posture)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Testing & Quality Gates](#testing--quality-gates)
- [Roadmap](#roadmap)
- [License & Attribution](#license--attribution)

---

## Key Capabilities

- **Real-Time Pacing & WPM Telemetry:** Tracks both session-average and 15-second rolling words-per-minute (WPM) with outlier-capped active speaking windows (`>15s` idle gaps excluded), allowing presenters to calibrate cadence in real time.
- **Bilingual Live Transcription (EN / UK):** Generates immediate on-screen captions with append-only block rendering (`60` words per block), smart bottom-anchored auto-scroll, and one-click copy/export (`.txt`).
- **Deterministic Pause Analytics:** Computes long pauses (`≥1.5s`) strictly from committed ASR word timestamps (`startMs` / `endMs`), eliminating false positives from ambient room noise or microphone gain fluctuations.
- **Configurable Filler-Word Governance (PRO):** Enables PRO users to maintain a custom dictionary of up to 100 normalized words or multi-word phrases (`GET`/`PUT /api/v1/filler-dictionary`) for live highlighting and post-session breakdowns—zero hardcoded developer lists.
- **Milestone Progression:** Built-in 3-reel Pace Mastery milestone unlocker (`SlotMachineModal`) with synthesized Web Audio feedback to drive consistent rehearsal cadence.
- **Mobile-First Responsive Studio:** Optimized for `360px–430px` viewports with `44px+` touch targets, `touch-action: none` range sliders, fluid reel layouts, and `tabular-nums` KPI readouts.

---

## System Architecture

```text
┌──────────────────┐     ┌─────────────────────────┐     ┌──────────────────────────┐
│ Client Audio     │────▶│ AudioWorklet (16kHz)    │────▶│ Web Worker (tinyasr)     │
│ Native Capture   │     │ 5-Tap LPF + AGC Limiter │     │ Silero VAD + MT/ST WASM  │
└──────────────────┘     └─────────────────────────┘     └────────────┬─────────────┘
                                                                      │ 120ms Coalesced
                                                                      ▼
┌──────────────────┐     ┌─────────────────────────┐     ┌──────────────────────────┐
│ PostgreSQL       │◀───▶│ FastAPI (Async API)     │◀───▶│ External Store & rAF UI  │
│ users /          │     │ JWT + Argon2id Auth     │     │ 60fps Direct-DOM Updates │
│ presentations    │     │ Telemetry & PRO Dict    │     │ Zero Main-Thread Block   │
└──────────────────┘     └─────────────────────────┘     └──────────────────────────┘
```

### Architectural Principles
1. **Zero Audio Egress:** Raw microphone audio is captured, resampled, and transcribed entirely in the browser. Only lightweight JSON telemetry and user dictionary updates cross the network.
2. **Off-Main-Thread Compute:** Audio resampling runs in `AudioWorklet`; neural VAD + ASR inference runs in a dedicated Web Worker (`asr.worker.js`); UI rendering stays locked at 60fps.
3. **Strict Environment Parity:** Separate `docker-compose.dev.yml` (with one-shot Alembic migration container and hot-reload) and `docker-compose.prod.yml` (hardened non-root multi-stage builds).

---

## Client-Side Edge AI Pipeline

- **Capture & Resampling (`frontend/src/audio/micCapture.js`):**
  - Captures native hardware audio and downsamples to `16000 Hz` mono via an `AudioWorklet` using a 5-tap anti-aliasing low-pass filter.
  - Applies lightweight Automatic Gain Control (AGC) with a soft limiter so quiet microphones reach optimal speech amplitude without clipping.
  - Streams `~40–60ms` chunks over Transferable `ArrayBuffer`s to minimize worker postMessage overhead.
- **WASM Runtime (`frontend/src/workers/asr.worker.js`):**
  - Executes `dkaraush/tinyasr` + Silero VAD with strict language locking (`'uk'` or `'en'`).
  - When `COOP`/`COEP` headers enable `crossOriginIsolated === true`, loads multi-threaded `tinyasr-mt.wasm` backed by `SharedArrayBuffer` and `Atomics` threadpools; automatically falls back to single-threaded `tinyasr.wasm` otherwise.
  - Persists downloaded models in `CacheStorage` for zero-cold-start subsequent sessions, pre-warmed on page mount.

---

## Frontend Performance Architecture

- **Hot-Path Isolation (`rAF` + Direct DOM):**
  - `useTimer.js` updates the elapsed timer `textContent` and progress bar `scaleX` via `requestAnimationFrame` + `performance.now()` on direct DOM `ref`s.
  - `AudioVisualizer.jsx` drives 24-bar `scaleY` transforms via `requestAnimationFrame` with zero React state updates per audio chunk.
- **Granular External Store (`frontend/src/stores/speechStore.js`):**
  - Uses `useSyncExternalStore` with atomic selectors (`useWpmMetrics`, `usePauseMetrics`, `useFillerMetrics`, `useTranscriptState`, `useTranscriptTail`, `useSessionStatus`).
  - Coalesces incoming `TRANSCRIPT_UPDATE` bursts on a ~120ms frame budget and wraps derived metric recalculations in `React.startTransition`.
- **O(1) Transcript Rendering (`LiveTranscriptPanel.jsx`):**
  - Splits transcripts into append-only `React.memo` blocks (`60` words per block) paired with `content-visibility: auto` and `contain-intrinsic-size: auto 3.5rem`, plus a fast-updating live `<span>` tail.
- **Code Splitting:** Secondary routes and modals (`AuthPage`, `DashboardPage`, `SessionSummaryModal`, `SlotMachineModal`) are lazy-loaded via `React.lazy` + `Suspense`.

---

## Backend & Database Schema

- **Async Runtime:** FastAPI + async SQLAlchemy 2.0 (`asyncpg` for PostgreSQL / Neon in production; `aiosqlite` for zero-config local development) with Alembic migrations.
- **Vertical Slice Layout (`backend/app/`):**
  - `auth/`: Registration, login, JWT bearer authentication, Argon2id password hashing (`pwdlib`).
  - `presentations/`: Session persistence and historical analytics retrieval.
  - `filler_dictionary/`: PRO-gated custom filler-word CRUD.
  - `slots/`: 3-spin Pace Mastery milestone unlocker.
  - `core/`: `pydantic-settings` configuration, async engine factory (with `asyncpg` SSL normalization), and structured `dev`/`prod` logging.
- **Core Tables:**
  - `users`: `id`, `email`, `hashed_password`, `is_pro`, `slot_spins_used`, `custom_filler_words` (`JSON`/`JSONB`), `created_at`.
  - `presentations`: `id`, `user_id`, `title`, `duration_seconds`, `target_seconds`, `wpm`, `word_count`, `pause_count`, `filler_count`, `filler_breakdown` (`JSON`/`JSONB`), `transcript`, `created_at`.

---

## API Reference

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Service healthcheck (`{"status": "ok"}`). |
| `POST` | `/api/v1/auth/register` | Public | Register a new user account. |
| `POST` | `/api/v1/auth/login` | Public | Authenticate and receive a JWT access token. |
| `GET` | `/api/v1/auth/me` | Bearer | Retrieve current user profile & PRO status. |
| `GET` | `/api/v1/presentations` | Bearer | List saved rehearsal sessions. |
| `POST` | `/api/v1/presentations` | Bearer | Persist a completed rehearsal session. |
| `GET` | `/api/v1/filler-dictionary` | Bearer (PRO) | Retrieve user's custom filler-word list (`403` if not PRO). |
| `PUT` | `/api/v1/filler-dictionary` | Bearer (PRO) | Replace custom filler-word list (normalized, deduplicated, max 100). |
| `POST` | `/api/v1/slots/spin` | Bearer | Execute a Pace Mastery milestone spin. |

---

## Security & Privacy Posture

- **Client-Side Audio Isolation:** Microphone streams never leave the browser.
- **Cross-Origin Isolation:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` enforced in Vite (`dev`), Nginx (`prod`), and Cloudflare Pages (`_headers`).
- **Authentication:** Passwords hashed with Argon2id (`pwdlib`); stateless JWT bearer tokens with configurable expiration.
- **Container Hardening:** Production backend runs as non-root `appuser` with explicit resource limits and healthchecks.

---

## Technology Stack

| Domain | Stack | Rationale |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite, Tailwind CSS | `useSyncExternalStore` atomic slices and `rAF` direct-DOM updates sustain 60fps during long sessions. |
| **Edge AI** | `dkaraush/tinyasr` (Rust/WASM), Silero VAD | Eliminates cloud inference latency, server GPU spend, and audio privacy exposure. |
| **Backend** | FastAPI, Pydantic v2, `pwdlib` (Argon2id) | Strongly typed async REST API with modern cryptographic password hashing. |
| **Database** | PostgreSQL (Neon), SQLAlchemy 2.0, Alembic | ACID-compliant relational + `JSONB` persistence with versioned migrations. |
| **Infrastructure** | Docker Compose (`dev`/`prod`), Nginx, Cloudflare Pages | Enforces `COOP`/`COEP` isolation, multi-stage non-root containers, and gzip/immutable asset caching. |

---

## Getting Started

> [!IMPORTANT]
> Prebuilt `tinyasr` WASM binaries and models are already bundled in `frontend/public/wasm/` and `frontend/public/models/`—no local Rust/Cargo compilation is required.

### Option A: Docker Compose (Development)
```bash
cp .env.example .env
# Boots Postgres 17, runs one-shot Alembic migrations, and starts hot-reload backend & Vite
docker compose -f docker-compose.dev.yml up --build
```

### Option B: Docker Compose (Production)
```bash
cp .env.example .env
# Builds hardened multi-stage backend & Nginx frontend with COOP/COEP headers
docker compose -f docker-compose.prod.yml up -d --build
```

### Option C: Manual Local Setup
```bash
# 1. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

---

## Environment Variables

See [.env.example](.env.example) for the full template:

- `APP_ENV`: `dev` or `prod` (defaults to `dev`).
- `LOG_LEVEL`: `DEBUG` (dev) or `INFO` (prod).
- `JWT_SECRET`: Minimum 32-character secret for signing JWT tokens.
- `DATABASE_URL`: Async SQLAlchemy URL (`sqlite+aiosqlite:///...` in dev, `postgresql+asyncpg://...` or Neon `postgresql://...` in prod).
- `CORS_ORIGINS`: JSON array of allowed frontend origins.
- `VITE_APP_ENV`: Frontend logger mode (`dev` or `prod`).

---

## Testing & Quality Gates

```bash
# Frontend unit & integration suite (Vitest + V8 coverage: 20 files, 89 tests, 100% statements/lines)
npm --prefix frontend run test:coverage

# Frontend production bundle
npm --prefix frontend run build

# Backend test suite (Pytest: 100 tests)
backend/.venv/bin/pytest backend/tests --tb=short -q

# Backend lint & typecheck
backend/.venv/bin/ruff check backend/app backend/tests
backend/.venv/bin/pyrefly check backend/app
```

---

## Roadmap

- [ ] **Slide-Deck Synchronization:** Timer cues aligned with presentation slide transitions.
- [ ] **Longitudinal Analytics:** Multi-session WPM and pause-reduction trend reporting.
- [ ] **Custom Cadence Profiles:** Configurable target WPM bands for keynotes, briefings, and defenses.
- [ ] **Offline PWA Support:** Full offline rehearsal with deferred telemetry synchronization.

---

## License & Attribution

Licensed under **GPL-3.0** — see [LICENSE](LICENSE).  
Client-side neural ASR and Silero VAD powered by [`dkaraush/tinyasr`](https://github.com/dkaraush/tinyasr).
