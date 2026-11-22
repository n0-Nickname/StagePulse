import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import LiveMetricsBar from './LiveMetricsBar.jsx';
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

  it('renders LiveMetricsBar across pacing zones and silent pause state', () => {
    const { rerender } = render(
      <LanguageProvider>
        <LiveMetricsBar
          wpm={135}
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
});
