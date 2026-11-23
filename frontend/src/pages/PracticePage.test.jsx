import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PracticePage from './PracticePage.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

const mockNavigate = vi.fn();
const mockCreatePresentation = vi.fn();
const mockGetFillerDictionary = vi.fn();
const mockUpdateFillerDictionary = vi.fn();
const mockOpenSlotModal = vi.fn();
const authState = {
  user: { id: 1, email: 'speaker@stagepulse.dev', is_pro: true },
  openSlotModal: mockOpenSlotModal,
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual('../api/client.js');
  return {
    ...actual,
    presentationsApi: {
      create: (...args) => mockCreatePresentation(...args),
    },
    getFillerDictionary: (...args) => mockGetFillerDictionary(...args),
    updateFillerDictionary: (...args) => mockUpdateFillerDictionary(...args),
  };
});

describe('PracticePage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authState.user = { id: 1, email: 'speaker@stagepulse.dev', is_pro: true };
    mockGetFillerDictionary.mockResolvedValue({ words: [] });
    mockUpdateFillerDictionary.mockResolvedValue({ words: [] });
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
    expect(screen.getByTestId('wasm-mode-pill')).toHaveTextContent(/ST-WASM|MT-WASM/);
    expect(screen.getByTestId('wasm-mode-pill')).toHaveTextContent(/en-US/);
    expect(screen.getByTestId('live-filler-count')).toBeInTheDocument();

    const startBtn = screen.getByRole('button', { name: /Start rehearsal/i });
    expect(startBtn.className).toContain('min-h-[48px]');

    // Mobile responsive touch targets & stacked full-width slider
    const slider = screen.getByLabelText(/Mic sensitivity/i);
    expect(slider.className).toContain('w-full');
    expect(slider.className).toContain('min-h-[44px]');
    expect(slider.className).toContain('touch-none');
    expect(slider.className).not.toContain('sm:w-32');
    expect(screen.getByTestId('noise-gate-value')).toHaveTextContent('0.018');
    expect(screen.getByTestId('noise-gate-header').className).toContain('justify-between');
    expect(screen.getByRole('button', { name: '1m' }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /^Set$/i }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /Simulated mic: Off/i }).className).toContain(
      'min-h-[44px]'
    );

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
    expect(screen.getByTestId('noise-gate-value')).toHaveTextContent('0.060');

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

  it('locks filler KPI card and custom dictionary behind PRO badge/upgrade CTA for non-PRO users', () => {
    authState.user = { id: 2, email: 'free@stagepulse.dev', is_pro: false };

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    expect(mockGetFillerDictionary).not.toHaveBeenCalled();
    expect(screen.getByTestId('live-filler-locked')).toBeInTheDocument();
    expect(screen.getByTestId('filler-dict-locked')).toBeInTheDocument();

    const unlockButtons = screen.getAllByRole('button', { name: /Upgrade to PRO/i });
    expect(unlockButtons.length).toBe(2);
    fireEvent.click(unlockButtons[0]);
    fireEvent.click(unlockButtons[1]);
    expect(mockOpenSlotModal).toHaveBeenCalledTimes(2);
  });

  it('allows PRO users to load, add, remove custom filler words with instant scanning and error rollback', async () => {
    mockGetFillerDictionary.mockResolvedValueOnce({ words: ['like'] });
    mockUpdateFillerDictionary
      .mockResolvedValueOnce({ words: ['like', 'як би'] })
      .mockRejectedValueOnce({ status: 500, message: 'Sync failed' })
      .mockResolvedValueOnce({ words: [] });

    let rec = null;
    window.SpeechRecognition = class {
      start() {
        rec = this;
      }
      abort() {}
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(mockGetFillerDictionary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('like')).toBeInTheDocument());

    // Start rehearsal and emit speech containing "як би" (not yet in dictionary)
    fireEvent.click(screen.getByRole('button', { name: /Start rehearsal/i }));
    await waitFor(() => expect(rec).not.toBeNull());
    await act(async () => {
      rec.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript: 'Це як би тест' }], { isFinal: true })],
      });
    });
    expect(screen.getByTestId('live-filler-count')).toHaveTextContent('0');

    // Empty and duplicate inputs are ignored without backend calls
    const input = screen.getByLabelText(/Custom filler word or phrase/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form'));
    fireEvent.change(input, { target: { value: 'LIKE' } });
    fireEvent.submit(input.closest('form'));
    expect(mockUpdateFillerDictionary).not.toHaveBeenCalled();

    // Add "Як би" -> instant store re-scan updates live-filler-count to 1 and syncs backend
    fireEvent.change(input, { target: { value: '  Як   би ' } });
    await act(async () => {
      fireEvent.submit(input.closest('form'));
    });
    await waitFor(() =>
      expect(mockUpdateFillerDictionary).toHaveBeenCalledWith(['like', 'як би'])
    );
    expect(screen.getByTestId('live-filler-count')).toHaveTextContent('1');

    // Backend failure on remove rolls back tags and shows error alert
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Remove як би/i }));
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sync failed'));
    expect(screen.getByText('як би')).toBeInTheDocument();

    // Successful remove
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Remove like/i }));
    });
    await waitFor(() => expect(mockUpdateFillerDictionary).toHaveBeenLastCalledWith(['як би']));
    expect(screen.queryByText('like')).not.toBeInTheDocument();

    // Also cover initial fetch failure & array response fallback on unmount/remount
    delete window.SpeechRecognition;
    unmount();

    mockGetFillerDictionary.mockRejectedValueOnce({ status: 500, message: 'Dict load error' });
    const { unmount: unmountErr } = render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Dict load error'));
    unmountErr();

    // Unmount while getFillerDictionary is pending (resolve & reject after unmount) + array payload
    let resolvePending;
    let rejectPending;
    mockGetFillerDictionary
      .mockImplementationOnce(() => new Promise((res) => { resolvePending = res; }))
      .mockImplementationOnce(() => new Promise((_, rej) => { rejectPending = rej; }));

    const view1 = render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );
    view1.unmount();
    await act(async () => {
      resolvePending(['arrayWord']);
    });

    const view2 = render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );
    view2.unmount();
    await act(async () => {
      rejectPending(new Error('late reject'));
    });

    mockGetFillerDictionary.mockResolvedValueOnce(['arrayWord']);
    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('arrayword')).toBeInTheDocument());
  });
});
