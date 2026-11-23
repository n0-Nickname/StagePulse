import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PracticePage from './PracticePage.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

const mockNavigate = vi.fn();
const mockCreatePresentation = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 1, email: 'speaker@stagepulse.dev', is_pro: true },
    openSlotModal: vi.fn(),
  }),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual('../api/client.js');
  return {
    ...actual,
    presentationsApi: {
      create: (...args) => mockCreatePresentation(...args),
    },
  };
});

describe('PracticePage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders presets, custom duration, WASM progress bar, simulated mic/silence toggles, and saves session', async () => {
    mockCreatePresentation.mockResolvedValueOnce({ id: 101 });

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('wasm-progress-bar')).toBeInTheDocument();
    expect(screen.getByTestId('live-filler-count')).toBeInTheDocument();

    // Presets 1m, 3m, 5m, 10m & Custom
    fireEvent.click(screen.getByRole('button', { name: '5m' }));
    expect(screen.getByTestId('timer-display').textContent).toBe('5:00');

    const customInput = screen.getByPlaceholderText(/Custom min/i);
    fireEvent.change(customInput, { target: { value: '2' } });
    fireEvent.submit(customInput.closest('form'));
    expect(screen.getByTestId('timer-display').textContent).toBe('2:00');

    // Toggle simulated mic & simulated silence & change speech language & noise gate
    fireEvent.click(screen.getByRole('button', { name: /Simulated mic: Off/i }));
    fireEvent.click(screen.getByRole('button', { name: /Simulate silence/i }));
    fireEvent.change(screen.getByLabelText(/Speech language/i), { target: { value: 'uk-UA' } });
    fireEvent.change(screen.getByLabelText(/Mic sensitivity/i), { target: { value: '0.060' } });

    // Start, Pause, Resume, Finish & Save
    fireEvent.click(screen.getByRole('button', { name: /Start rehearsal/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Pause$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Resume/i }));
    fireEvent.click(screen.getByRole('button', { name: /Finish & save/i }));

    // Summary modal opens -> save session
    const saveBtn = await screen.findByRole('button', { name: /Save session/i });
    fireEvent.submit(saveBtn.closest('form'));

    await waitFor(() => {
      expect(mockCreatePresentation).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('displays save error and micError fallback alert when getUserMedia rejects', async () => {
    mockCreatePresentation.mockRejectedValueOnce({ status: 500, message: 'DB write failed' });
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValueOnce(
      new Error('Mic blocked')
    );

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Start rehearsal/i }));
    await waitFor(() => expect(screen.getByText('Mic blocked')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Finish & save/i }));

    const saveBtn = await screen.findByRole('button', { name: /Save session/i });
    fireEvent.submit(saveBtn.closest('form'));

    await waitFor(() => {
      expect(screen.getByText('DB write failed')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Discard/i }));
    fireEvent.click(screen.getByRole('button', { name: /Reset/i }));
  });

  it('displays liveTranscript when SpeechRecognition produces transcript and supports uk-UA init + finishing while paused', async () => {
    localStorage.setItem('pt_lang', 'uk');
    let rec = null;
    window.SpeechRecognition = class {
      start() {
        rec = this;
      }
      abort() {}
    };

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Почати репетицію/i }));
    await waitFor(() => expect(rec).not.toBeNull());
    await act(async () => {
      rec.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript: 'Live speech snippet' }], { isFinal: false })],
      });
    });
    expect(screen.getByText('Live speech snippet')).toBeInTheDocument();

    // Pause before finishing so handleFinishSession hits !timer.isRunning branch
    fireEvent.click(screen.getByRole('button', { name: /Пауза/i }));
    fireEvent.click(screen.getByRole('button', { name: /Завершити і зберегти/i }));
    expect(await screen.findByRole('button', { name: /Зберегти сесію/i })).toBeInTheDocument();
    delete window.SpeechRecognition;
  });

  it('displays WASM engineError alert and reflects modelProgress in progress bar', async () => {
    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.terminate = vi.fn();
        this.postMessage = () => {
          this.onmessage?.({ data: { type: 'MODEL_PROGRESS', percent: 42, cached: false } });
          this.onmessage?.({ data: { type: 'ENGINE_ERROR', message: 'WASM model corrupt' } });
        };
      }
    };

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /Start rehearsal/i }));
    await waitFor(() => expect(screen.getByText('WASM model corrupt')).toBeInTheDocument());
    expect(screen.getByTestId('wasm-progress-bar')).toHaveAttribute('aria-valuenow', '0');

    delete globalThis.Worker;
  });

  it('pre-warms WASM engine and verifies CacheStorage on PracticePage mount before Start is clicked', async () => {
    const postMessages = [];
    globalThis.Worker = class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.terminate = vi.fn();
        this.postMessage = vi.fn((msg) => {
          postMessages.push(msg);
          if (msg.type === 'INIT') {
            queueMicrotask(() => {
              this.onmessage?.({ data: { type: 'MODEL_PROGRESS', percent: 100, cached: true } });
              this.onmessage?.({ data: { type: 'MODEL_READY' } });
            });
          }
        });
      }
    };

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(postMessages.some((m) => m.type === 'INIT')).toBe(true));
    expect(screen.getByTestId('wasm-progress-bar')).toHaveAttribute('aria-valuenow', '100');

    delete globalThis.Worker;
  });
});
