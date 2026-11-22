import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

const mockOpenSlotModal = vi.fn();
const authState = {
  user: { id: 1, email: 'speaker@stagepulse.dev', is_pro: false },
  openSlotModal: mockOpenSlotModal,
};

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

const mockListPresentations = vi.fn();

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual('../api/client.js');
  return {
    ...actual,
    presentationsApi: {
      list: (...args) => mockListPresentations(...args),
    },
  };
});

describe('DashboardPage, StatsOverview, and HistoryTable', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authState.user.is_pro = false;
  });

  it('handles error state with retry, then renders empty history', async () => {
    mockListPresentations
      .mockRejectedValueOnce({ status: 500, message: 'Backend unreachable' })
      .mockResolvedValueOnce({
        is_pro: false,
        total_count: 0,
        locked_history_count: 0,
        stats: { total_sessions: 0, total_practice_sec: 0, avg_wpm: null, avg_pauses: null },
        items: [],
      });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <DashboardPage />
        </LanguageProvider>
      </MemoryRouter>
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Backend unreachable');

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() => {
      expect(screen.getByText(/No saved rehearsals yet/i)).toBeInTheDocument();
    });
  });

  it('renders locked state, row expansion, unlock triggers, and full PRO analytics', async () => {
    mockListPresentations.mockResolvedValueOnce({
      is_pro: false,
      total_count: 2,
      locked_history_count: 1,
      stats: { total_sessions: 2, total_practice_sec: 3700, avg_wpm: null, avg_pauses: null },
      items: [
        {
          id: 1,
          title: 'Locked Keynote',
          target_duration_sec: 180,
          actual_duration_sec: 185,
          word_count: 420,
          wpm: null,
          pause_count: null,
          total_pause_sec: null,
          pacing_status: null,
          timing_status: 'overtime',
          score: 79,
          verdict: '',
          is_analytics_locked: true,
          created_at: '2026-11-20T10:00:00Z',
        },
      ],
    });

    const { unmount } = render(
      <MemoryRouter>
        <LanguageProvider>
          <DashboardPage />
        </LanguageProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Locked Keynote')).toBeInTheDocument());
    expect(screen.getByText(/1h 1m/i)).toBeInTheDocument();

    // Expand locked row & click locked badges (table cells + stat cards + footer)
    fireEvent.click(screen.getByText('Locked Keynote'));
    expect(screen.getByText(/No verdict recorded/i)).toBeInTheDocument();

    // Click inline locked WPM and Pause blur buttons in table
    fireEvent.click(screen.getByText('142').closest('button'));
    fireEvent.click(screen.getByText('2 (4.1s)').closest('button'));
    // Click locked stat card blur buttons
    fireEvent.click(screen.getByText('138').closest('button'));
    fireEvent.click(screen.getByText('2.4').closest('button'));

    const unlockButtons = screen.getAllByRole('button', { name: /Unlock PRO/i });
    fireEvent.click(unlockButtons[0]);
    expect(mockOpenSlotModal).toHaveBeenCalledTimes(5);
    unmount();

    // Now test PRO mode with full stats, fillers, pacing curves, hours/secs formatting, and invalid date catch
    const dateSpy = vi
      .spyOn(Date.prototype, 'toLocaleDateString')
      .mockImplementationOnce(() => {
        throw new Error('locale failure');
      });
    authState.user.is_pro = true;
    mockListPresentations.mockResolvedValueOnce({
      is_pro: true,
      total_count: 2,
      locked_history_count: 0,
      stats: { total_sessions: 2, total_practice_sec: 135, avg_wpm: 138.4, avg_pauses: 1.5 },
      items: [
        {
          id: 2,
          title: 'PRO Keynote',
          target_duration_sec: 180,
          actual_duration_sec: 170,
          word_count: 400,
          wpm: 141,
          pause_count: 1,
          total_pause_sec: 1.8,
          pacing_status: 'optimal',
          timing_status: 'on_time',
          score: 94,
          verdict: 'Outstanding rhythm.',
          filler_count: 3,
          top_fillers_json: JSON.stringify({ like: 2, um: 1 }),
          pacing_timeline_json: JSON.stringify([{ sec: 10, wpm: 140 }]),
          is_analytics_locked: false,
          created_at: '2026-11-21T10:00:00Z',
        },
        {
          id: 3,
          title: 'Zero Fillers Talk',
          target_duration_sec: 120,
          actual_duration_sec: null,
          word_count: 200,
          wpm: null,
          pause_count: null,
          total_pause_sec: null,
          pacing_status: 'too_fast',
          timing_status: 'under_time',
          score: null,
          verdict: 'Too brisk.',
          filler_count: 0,
          top_fillers_json: 'invalid-json',
          pacing_timeline_json: '',
          is_analytics_locked: false,
          created_at: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <LanguageProvider>
          <DashboardPage />
        </LanguageProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('PRO Keynote')).toBeInTheDocument());
    expect(screen.getByText('2m 15s')).toBeInTheDocument();
    expect(screen.getByText('138')).toBeInTheDocument();
    dateSpy.mockRestore();

    fireEvent.click(screen.getByText('PRO Keynote'));
    expect(screen.getByText('Outstanding rhythm.')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    // Collapse row
    fireEvent.click(screen.getByText('PRO Keynote'));
    expect(screen.queryByText('Outstanding rhythm.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Zero Fillers Talk'));
    expect(screen.getByText(/No filler words detected/i)).toBeInTheDocument();

    // Test seconds-only total_practice_sec (45s), uk locale, pre-parsed objects & unknown timing_status
    localStorage.setItem('pt_lang', 'uk');
    mockListPresentations.mockResolvedValueOnce({
      is_pro: true,
      total_count: 1,
      locked_history_count: 0,
      stats: { total_sessions: 1, total_practice_sec: 45, avg_wpm: null, avg_pauses: null },
      items: [
        {
          id: 9,
          title: 'Short Practice',
          target_duration_sec: 60,
          actual_duration_sec: 45,
          word_count: 100,
          wpm: 125,
          pause_count: 0,
          total_pause_sec: 0,
          pacing_status: 'optimal',
          timing_status: 'unknown_status',
          score: 80,
          verdict: 'Good.',
          filler_count: 1,
          top_fillers_json: { ну: 1 },
          pacing_timeline_json: [{ sec: 10, wpm: 0 }, { sec: 20, wpm: 130 }],
          is_analytics_locked: false,
          created_at: '2026-11-21T10:00:00Z',
        },
      ],
    });
    render(
      <MemoryRouter>
        <LanguageProvider>
          <DashboardPage />
        </LanguageProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText('Short Practice')).toBeInTheDocument());
    expect(screen.getByText('45с')).toBeInTheDocument();
  });
});
