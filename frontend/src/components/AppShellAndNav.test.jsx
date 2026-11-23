import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import LiveMetricsBar from './LiveMetricsBar.jsx';
import AudioVisualizer from './AudioVisualizer.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';
import { authApi, presentationsApi } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual('../api/client.js');
  return {
    ...actual,
    authApi: {
      me: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
    },
    presentationsApi: {
      list: vi.fn().mockResolvedValue({
        is_pro: false,
        total_count: 0,
        locked_history_count: 0,
        stats: { total_sessions: 0, total_practice_sec: 0 },
        items: [],
      }),
      create: vi.fn(),
    },
  };
});

describe('App routing, ProtectedRoute, Navbar, and LiveMetricsBar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('redirects unauthenticated users from /practice to /auth?mode=login and shows spinner while loading', async () => {
    localStorage.setItem('pt_token', 'tok');
    let resolveMe;
    authApi.me.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMe = resolve;
        })
    );

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <App />
      </MemoryRouter>
    );

    // Loading spinner is visible while authApi.me is pending
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();

    resolveMe(null);
    await screen.findByRole('heading', { name: /Rehearse on time/i });
  });

  it('renders authenticated /practice, Navbar with email & sign out, and redirects /auth when logged in', async () => {
    localStorage.setItem('pt_token', 'tok');
    authApi.me.mockResolvedValue({
      id: 1,
      email: 'speaker@stagepulse.dev',
      is_pro: true,
      spin_count: 1,
      spins_remaining: 0,
    });

    render(
      <MemoryRouter initialEntries={['/auth']}>
        <App />
      </MemoryRouter>
    );

    await screen.findByText('speaker@stagepulse.dev');
    const desktopNav = screen.getByLabelText('App navigation');
    expect(within(desktopNav).getByRole('link', { name: /Studio/i })).toHaveAttribute(
      'href',
      '/practice'
    );
    expect(within(desktopNav).getByRole('link', { name: /Dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );

    // Navigate to /dashboard via mobile/desktop link & toggle UA/EN in LanguageSwitcher
    fireEvent.click(screen.getByRole('button', { name: 'UA' }));
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    fireEvent.click(within(desktopNav).getByRole('link', { name: /Dashboard/i }));
    await screen.findByRole('heading', { name: /Presentation analytics/i });
    expect(presentationsApi.list).toHaveBeenCalled();

    // Sign out redirects to /auth
    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));
    await screen.findByRole('tab', { name: /Log in/i });
  });

  it('lazy-loads SlotMachineModal when Unlock PRO is clicked for non-PRO user', async () => {
    localStorage.setItem('pt_token', 'tok');
    authApi.me.mockResolvedValue({
      id: 2,
      email: 'free@stagepulse.dev',
      is_pro: false,
      spin_count: 0,
      spins_remaining: 3,
    });

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <App />
      </MemoryRouter>
    );

    const unlockBtn = await screen.findByRole('button', { name: /Unlock PRO/i });
    fireEvent.click(unlockBtn);
    await screen.findByRole('heading', { name: /Unlock PRO analytics/i });
  });

  it('renders LiveMetricsBar across pacing zones and silent pause state', () => {
    const { rerender } = render(
      <LanguageProvider>
        <LiveMetricsBar
          wpm={135}
          rollingWpm={142}
          pacingZone="optimal"
          wordCount={120}
          pauseCount={1}
          totalPauseSec={2}
          fillerCount={0}
          isSilentPause={false}
          estimationMethod="speech_api"
        />
      </LanguageProvider>
    );

    expect(screen.getByTestId('live-wpm-value')).toHaveTextContent('135');
    expect(screen.getByTestId('rolling-wpm-value')).toHaveTextContent('142');
    expect(screen.getByText('On pace')).toBeInTheDocument();

    rerender(
      <LanguageProvider>
        <LiveMetricsBar
          wpm={200}
          pacingZone="unknown_zone"
          wordCount={200}
          pauseCount={2}
          totalPauseSec={5}
          fillerCount={3}
          isSilentPause={true}
          currentSilenceSec={2.3}
          estimationMethod="audio_burst"
        />
      </LanguageProvider>
    );

    expect(screen.getByTestId('live-filler-count')).toHaveTextContent('3');
    expect(screen.getByText(/Silent \(2\.3s\)/i)).toBeInTheDocument();
  });

  it('drives AudioVisualizer bars and RMS label via rAF DOM transform scaleY without React re-renders', () => {
    const rafQueue = [];
    const origRaf = globalThis.requestAnimationFrame;
    const origCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };
    globalThis.cancelAnimationFrame = vi.fn();

    const rmsRef = { current: 0.42 };
    const barsRef = { current: [0.5, 0.9] };

    const { rerender, unmount } = render(
      <LanguageProvider>
        <AudioVisualizer
          frequencyBars={[0.05, 0.05]}
          rmsRef={rmsRef}
          barsRef={barsRef}
          isRunning={true}
        />
      </LanguageProvider>
    );

    expect(rafQueue.length).toBe(1);
    rafQueue.shift()(16);

    const bars = screen.getAllByTestId('audio-meter-bar');
    expect(bars[0].style.transform).toBe('scaleY(0.5)');
    expect(bars[1].style.transform).toBe('scaleY(0.9)');
    expect(screen.getByTestId('audio-rms-value')).toHaveTextContent('RMS 0.420');

    rerender(
      <LanguageProvider>
        <AudioVisualizer
          frequencyBars={[0.05, 0.05]}
          rmsRef={rmsRef}
          barsRef={barsRef}
          isRunning={false}
        />
      </LanguageProvider>
    );
    expect(screen.getByTestId('audio-rms-value')).toHaveTextContent('RMS 0.000');
    expect(bars[0].style.transform).toBe('scaleY(0.08)');

    // Standalone AudioVisualizer without refs + silent pause color state
    rerender(
      <LanguageProvider>
        <AudioVisualizer
          frequencyBars={[0.3, 0.6]}
          rmsLevel={0.123}
          isRunning={true}
          isSilentPause={true}
        />
      </LanguageProvider>
    );
    expect(screen.getByTestId('audio-rms-value')).toHaveTextContent('RMS 0.123');
    expect(screen.getByText(/Silence detected/i)).toBeInTheDocument();

    unmount();
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
  });
});
