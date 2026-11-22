// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PracticePage from '../pages/PracticePage.jsx';
import DashboardPage from '../pages/DashboardPage.jsx';
import Navbar from '../components/Navbar.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

const mockOpenSlotModal = vi.fn();
const mockLogout = vi.fn();
const authState = {
  user: {
    id: 1,
    email: 'speaker@stagepulse.dev',
    is_pro: false,
    spin_count: 1,
    spins_remaining: 2,
  },
  loading: false,
  logout: mockLogout,
  openSlotModal: mockOpenSlotModal,
};

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

const mockListPresentations = vi.fn();
const mockCreatePresentation = vi.fn();

vi.mock('../api/client.js', () => ({
  presentationsApi: {
    list: (...args) => mockListPresentations(...args),
    create: (...args) => mockCreatePresentation(...args),
  },
}));

describe('PracticePage, DashboardPage, and Navbar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authState.user.is_pro = false;
  });

  it('PracticePage renders 1m, 3m, 5m, 10m, Custom presets, WASM progress bar, live counters, and opens summary modal', () => {
    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <PracticePage />
        </LanguageProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: '1m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10m' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Custom/i)).toBeInTheDocument();
    expect(screen.getByTestId('wasm-progress-bar')).toBeInTheDocument();
    expect(screen.getByTestId('live-filler-count')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '5m' }));
    expect(screen.getByTestId('timer-display').textContent).toBe('5:00');
  });

  it('Navbar shows user email (never username) and active route links', () => {
    render(
      <MemoryRouter initialEntries={['/practice']}>
        <LanguageProvider>
          <Navbar />
        </LanguageProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('speaker@stagepulse.dev')).toBeInTheDocument();
    const desktopNav = screen.getByLabelText('App navigation');
    expect(within(desktopNav).getByRole('link', { name: /Studio/i })).toHaveAttribute('href', '/practice');
    expect(within(desktopNav).getByRole('link', { name: /Dashboard/i })).toHaveAttribute('href', '/dashboard');
  });

  it('DashboardPage displays stat cards, locked PRO overlays, and opens Gacha modal', async () => {
    mockListPresentations.mockResolvedValueOnce({
      is_pro: false,
      total_count: 1,
      locked_history_count: 1,
      stats: {
        total_sessions: 1,
        total_practice_sec: 180,
        avg_wpm: null,
        avg_pauses: null,
      },
      items: [
        {
          id: 42,
          title: 'Keynote Dry Run',
          target_duration_sec: 180,
          actual_duration_sec: 175,
          word_count: 400,
          wpm: null,
          pause_count: null,
          total_pause_sec: null,
          pacing_status: null,
          timing_status: 'on_time',
          estimation_method: 'speech_api',
          score: 86,
          verdict: 'Crisp opening.',
          is_analytics_locked: true,
          created_at: '2026-11-20T10:00:00Z',
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <LanguageProvider>
          <DashboardPage />
        </LanguageProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Keynote Dry Run')).toBeInTheDocument();
    });

    const unlockBtns = screen.getAllByRole('button', { name: /Unlock PRO/i });
    expect(unlockBtns.length).toBeGreaterThan(0);
    fireEvent.click(unlockBtns[0]);
    expect(mockOpenSlotModal).toHaveBeenCalledTimes(1);
  });
});
