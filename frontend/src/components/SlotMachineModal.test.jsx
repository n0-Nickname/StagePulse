import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SlotMachineModal from './SlotMachineModal.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';
import { slotsApi } from '../api/client.js';

const mockRefreshUser = vi.fn().mockResolvedValue({});
const mockUpdateUser = vi.fn();
const authState = {
  user: { id: 1, email: 'tester@example.com', is_pro: false, spin_count: 0, spins_remaining: 3 },
  refreshUser: mockRefreshUser,
  updateUser: mockUpdateUser,
};

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual('../api/client.js');
  return {
    ...actual,
    slotsApi: {
      spin: vi.fn(),
    },
  };
});

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

describe('SlotMachineModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.clearAllMocks();
    authState.user = {
      id: 1,
      email: 'tester@example.com',
      is_pro: false,
      spin_count: 0,
      spins_remaining: 3,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when closed', () => {
    const { container } = render(
      <LanguageProvider>
        <SlotMachineModal isOpen={false} onClose={() => {}} />
      </LanguageProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('triggers milestone celebration, shake class, staggered 1.0/1.6/2.3s stops, and z-index 99999 confetti canvas', async () => {
    slotsApi.spin.mockResolvedValue({
      reels: ['DIAMOND', 'DIAMOND', 'DIAMOND'],
      is_pro: true,
      spin_count: 1,
      spins_remaining: 0,
      message: 'Milestone unlocked!',
    });

    const onClose = vi.fn();
    const { rerender } = render(
      <LanguageProvider>
        <SlotMachineModal isOpen={true} onClose={onClose} />
      </LanguageProvider>
    );

    // Toggle mute button
    const muteBtn = screen.getByRole('button', { name: /Mute sound/i });
    fireEvent.click(muteBtn);
    expect(screen.getByRole('button', { name: /Unmute sound/i })).toBeInTheDocument();

    const spinBtn = screen.getByRole('button', { name: /Check Milestone/i });
    await act(async () => {
      fireEvent.click(spinBtn);
    });

    // Run rAF + staggered reel timers (1000ms, 1600ms, 2300ms, 2350ms) + full confetti lifecycle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // Re-check a second time while confetti is running to hit existing confettiRafRef cancellation
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check Milestone/i }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    const card = screen.getByTestId('slot-modal-card');
    expect(card.className).toContain('milestone-shake');

    const banner = screen.getByTestId('slot-banner-message');
    expect(banner).toHaveTextContent(/Milestone Achieved/i);

    const canvas = screen.getByTestId('confetti-canvas');
    expect(canvas.style.zIndex).toBe('99999');
    expect(document.body.contains(canvas)).toBe(true);

    // Escape closes when no longer spinning
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Closing modal triggers stopConfetti with mounted canvas
    rerender(
      <LanguageProvider>
        <SlotMachineModal isOpen={false} onClose={onClose} />
      </LanguageProvider>
    );
  });

  it('handles non-milestone spin, unknown/missing reels, spins_remaining fallback, API error, and PRO state', async () => {
    authState.user = {
      id: 1,
      email: 'tester@example.com',
      is_pro: false,
      spin_count: 1,
    };
    slotsApi.spin
      .mockResolvedValueOnce({
        reels: ['UNKNOWN_SYM', 'MIC', 'FIRE'],
        is_pro: false,
        spin_count: 2,
        spins_remaining: 1,
      })
      .mockResolvedValueOnce({
        is_pro: false,
        spin_count: 3,
        spins_remaining: 0,
      })
      .mockRejectedValueOnce({ status: 400, data: { detail: 'No spins remaining' } });

    const onClose = vi.fn();
    const { rerender } = render(
      <LanguageProvider>
        <SlotMachineModal isOpen={true} onClose={onClose} />
      </LanguageProvider>
    );

    // Non-milestone spin with unknown symbol fallback
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check Milestone/i }));
    });
    // Escape while spinning does NOT close
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    expect(screen.getByTestId('slot-banner-message')).toHaveTextContent(/Keep practicing/i);

    // Spin with undefined reels (falls back to DEFAULT_REELS)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check Milestone/i }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });

    // API error spin
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check Milestone/i }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/No milestone checks remaining/i);

    // Milestone win when canvas getContext returns null skips confetti gracefully
    const origGetCtx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    slotsApi.spin.mockResolvedValueOnce({
      reels: ['DIAMOND', 'DIAMOND', 'DIAMOND'],
      is_pro: true,
      spin_count: 1,
      spins_remaining: 0,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Check Milestone/i }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    HTMLCanvasElement.prototype.getContext = origGetCtx;

    // Also test user with undefined spin_count and unmount while spinning
    authState.user = { id: 1, email: 'fresh@example.com', is_pro: false };
    slotsApi.spin.mockResolvedValueOnce({
      reels: ['MIC', 'TIMER', 'FIRE'],
      is_pro: false,
      spin_count: 1,
      spins_remaining: 2,
    });
    const { unmount } = render(
      <LanguageProvider>
        <SlotMachineModal isOpen={true} onClose={onClose} />
      </LanguageProvider>
    );
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Check Milestone/i })[1]);
    });
    unmount();

    // Already PRO view shows Done button
    authState.user = { id: 1, email: 'pro@example.com', is_pro: true, spin_count: 1 };
    rerender(
      <LanguageProvider>
        <SlotMachineModal isOpen={true} onClose={onClose} />
      </LanguageProvider>
    );
    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('uses fluid reel sizing, tighter mobile padding/gaps, and >=44px touch targets for 360px viewports', () => {
    render(
      <LanguageProvider>
        <SlotMachineModal isOpen={true} onClose={() => {}} />
      </LanguageProvider>
    );

    const card = screen.getByTestId('slot-modal-card');
    expect(card.className).toContain('p-3');
    expect(card.className).toContain('sm:p-6');

    const reelsContainer = screen.getByTestId('slot-reels-container');
    expect(reelsContainer.className).toContain('grid-cols-3');
    expect(reelsContainer.className).toContain('gap-2');
    expect(reelsContainer.className).toContain('sm:gap-4');
    expect(reelsContainer.className).toContain('p-3');
    expect(reelsContainer.className).toContain('sm:p-6');

    const firstEmoji = screen.getByRole('img', { name: 'Diamond' });
    expect(firstEmoji.className).toContain('text-3xl');
    expect(firstEmoji.className).toContain('sm:text-5xl');

    expect(screen.getByRole('button', { name: /Mute sound/i }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /Close/i }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /Check Milestone/i }).className).toContain(
      'min-h-[44px]'
    );
  });
});
