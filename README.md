# Presentation Timer

A full-stack presentation practice timer with live Web Audio RMS pause detection, Web Speech API WPM tracking (with automatic syllable-burst fallback), and a 3-spin Gacha Slot Machine PRO unlock.

## Project Structure

- `backend/` — FastAPI + SQLAlchemy 2.0 + SQLite REST API (`/api/auth`, `/api/slots`, `/api/presentations`)
- `frontend/` — React 18 + Vite + Tailwind CSS + Lucide icons

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

## Testing & Build

- Backend tests: `pytest backend/tests/`
- Frontend build: `npm --prefix frontend run build`
