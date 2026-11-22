// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SlotMachineModal from '../components/SlotMachineModal.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

vi.mock('../api/client.js', () => ({
  slotsApi: {
    spin: vi.fn().mockResolvedValue({
      reels: ['DIAMOND', 'DIAMOND', 'DIAMOND'],
      is_jackpot: true,
      is_pro: true,
      spin_count: 1,
      spins_remaining: 0,
      message: 'Jackpot!',
    }),
  },
}));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'tester', is_pro: false, spin_count: 0, spins_remaining: 3 },
    refreshUser: vi.fn().mockResolvedValue({}),
    updateUser: vi.fn(),
  }),
}));

describe('SlotMachineModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('triggers jackpot celebration, shake class, and z-index 99999 confetti canvas after 2350ms', async () => {
    render(
      <LanguageProvider>
        <SlotMachineModal isOpen={true} onClose={() => {}} />
      </LanguageProvider>
    );

    const spinBtn = screen.getByRole('button', { name: /Крутити|Spin/i });
    await act(async () => {
      fireEvent.click(spinBtn);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });

    const card = screen.getByTestId('slot-modal-card');
    expect(card.className).toContain('jackpot-shake');

    const banner = screen.getByTestId('slot-banner-message');
    expect(banner).toBeTruthy();

    const canvas = screen.getByTestId('confetti-canvas');
    expect(canvas.style.zIndex).toBe('99999');
    expect(document.body.contains(canvas)).toBe(true);
  });
});
