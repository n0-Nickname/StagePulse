# StagePulse — Presentation Timer & Neural Speech Telemetry

A full-stack presentation rehearsal studio featuring a client-side Rust/WASM neural speech recognition pipeline (`dkaraush/tinyasr`), 16kHz `AudioWorklet` capture, timestamp-accurate pause detection, live WPM & filler-word telemetry, and a 3-spin Gacha Slot Machine PRO unlock.

## Project Structure

- `backend/` — FastAPI + SQLAlchemy 2.0 + SQLite REST API (`/api/auth`, `/api/slots`, `/api/presentations`)
- `frontend/` — React 18 + Vite + Tailwind CSS + Web Worker Rust/WASM ASR adapter

## Quick Start

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Vite dev and preview servers include `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers required for `SharedArrayBuffer` / WASM threads.

## Testing & Build

- Backend tests: `pytest backend/tests/`
- Frontend coverage: `npm --prefix frontend run test:coverage`
- Frontend build: `npm --prefix frontend run build`

## License & Attribution

- Licensed under the **GNU General Public License v3.0** (see [`LICENSE`](LICENSE)).
- Client-side Rust/WASM speech recognition powered by **[dkaraush/tinyasr](https://github.com/dkaraush/tinyasr)** (`en-ru-uk` streaming model weights, GPL-3.0).
