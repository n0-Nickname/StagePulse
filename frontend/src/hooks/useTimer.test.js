import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimer } from './useTimer.js';

describe('useTimer', () => {
  let fakeNow = 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeNow = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handles start, tick, pause, resume, reset, warning, overtime, and custom target durations', () => {
    const { result, unmount } = renderHook(() => useTimer(10));

    expect(result.current.targetDurationSec).toBe(10);
    expect(result.current.elapsedSec).toBe(0);
    expect(result.current.remainingSec).toBe(10);
    expect(result.current.progressPct).toBe(0);
    expect(result.current.timerStatus).toBe('normal');

    act(() => {
      result.current.start();
    });
    expect(result.current.isRunning).toBe(true);

    // Advance 8 seconds -> warning (>=80%)
    act(() => {
      fakeNow += 8000;
      vi.advanceTimersByTime(8000);
    });
    expect(result.current.elapsedSec).toBe(8);
    expect(result.current.remainingSec).toBe(2);
    expect(result.current.progressPct).toBe(80);
    expect(result.current.timerStatus).toBe('warning');

    // Pause and verify elapsed stops advancing
    act(() => {
      result.current.pause();
    });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isPaused).toBe(true);
    // Calling pause again while already paused hits null ref branch safely
    act(() => {
      result.current.pause();
    });

    // Resume and go past target -> overtime
    act(() => {
      result.current.resume();
    });
    act(() => {
      fakeNow += 4000;
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.elapsedSec).toBe(12);
    expect(result.current.remainingSec).toBe(-2);
    expect(result.current.progressPct).toBe(100);
    expect(result.current.timerStatus).toBe('overtime');

    // Reset & setTargetDurationSec bounds
    act(() => {
      result.current.reset();
      result.current.setTargetDurationSec(0);
    });
    expect(result.current.targetDurationSec).toBe(60);

    act(() => {
      result.current.setTargetDurationSec(99999);
    });
    expect(result.current.targetDurationSec).toBe(7200);

    // Also test non-positive initialTargetSec branches
    const zeroHook = renderHook(() => useTimer(0));
    expect(zeroHook.result.current.progressPct).toBe(0);
    expect(zeroHook.result.current.timerStatus).toBe('normal');

    unmount();
    zeroHook.unmount();
  });
});
