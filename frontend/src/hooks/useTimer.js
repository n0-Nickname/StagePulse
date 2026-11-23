import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

export function formatTime(sec) {
  const isNegative = sec < 0;
  const abs = Math.abs(Math.round(sec));
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  return `${isNegative ? '-' : ''}${mins}:${secs.toString().padStart(2, '0')}`;
}

export function useTimer(initialTargetSec = 180) {
  const [targetDurationSec, setTargetDurationSecState] = useState(initialTargetSec);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const startWallMsRef = useRef(null);
  const accumulatedMsRef = useRef(0);
  const rafIdRef = useRef(null);
  const lastSyncedSecRef = useRef(0);
  const targetDurationRef = useRef(initialTargetSec);

  const remainingDisplayRef = useRef(null);
  const elapsedDisplayRef = useRef(null);
  const progressBarRef = useRef(null);

  const cancelTimerFrame = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const getTotalMs = useCallback(() => {
    const runningDelta =
      startWallMsRef.current !== null ? performance.now() - startWallMsRef.current : 0;
    return accumulatedMsRef.current + runningDelta;
  }, []);

  const getElapsedSec = useCallback(() => {
    return Math.floor(getTotalMs() / 1000);
  }, [getTotalMs]);

  const syncDomDisplay = useCallback((totalMs) => {
    const elapsed = Math.floor(totalMs / 1000);
    const target = targetDurationRef.current;
    if (remainingDisplayRef.current) {
      remainingDisplayRef.current.textContent = formatTime(target - elapsed);
    }
    if (elapsedDisplayRef.current) {
      elapsedDisplayRef.current.textContent = formatTime(elapsed);
    }
    if (progressBarRef.current) {
      const ratio = target > 0 ? Math.min(1, Math.max(0, totalMs / (target * 1000))) : 0;
      progressBarRef.current.style.transform = `scaleX(${ratio})`;
    }
  }, []);

  const scheduleFrameLoop = useCallback(() => {
    cancelTimerFrame();
    const tick = () => {
      const totalMs = getTotalMs();
      syncDomDisplay(totalMs);
      const nextSec = Math.floor(totalMs / 1000);
      if (nextSec !== lastSyncedSecRef.current) {
        lastSyncedSecRef.current = nextSec;
        setElapsedSec(nextSec);
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [cancelTimerFrame, getTotalMs, syncDomDisplay]);

  const start = useCallback(() => {
    cancelTimerFrame();
    accumulatedMsRef.current = 0;
    startWallMsRef.current = performance.now();
    lastSyncedSecRef.current = 0;
    syncDomDisplay(0);
    setElapsedSec(0);
    setIsRunning(true);
    setIsPaused(false);
    scheduleFrameLoop();
  }, [cancelTimerFrame, scheduleFrameLoop, syncDomDisplay]);

  const pause = useCallback(() => {
    if (startWallMsRef.current !== null) {
      accumulatedMsRef.current += performance.now() - startWallMsRef.current;
      startWallMsRef.current = null;
    }
    cancelTimerFrame();
    const pausedSec = Math.floor(accumulatedMsRef.current / 1000);
    lastSyncedSecRef.current = pausedSec;
    syncDomDisplay(accumulatedMsRef.current);
    setElapsedSec(pausedSec);
    setIsRunning(false);
    setIsPaused(true);
  }, [cancelTimerFrame, syncDomDisplay]);

  const resume = useCallback(() => {
    cancelTimerFrame();
    startWallMsRef.current = performance.now();
    setIsRunning(true);
    setIsPaused(false);
    scheduleFrameLoop();
  }, [cancelTimerFrame, scheduleFrameLoop]);

  const reset = useCallback(() => {
    cancelTimerFrame();
    startWallMsRef.current = null;
    accumulatedMsRef.current = 0;
    lastSyncedSecRef.current = 0;
    syncDomDisplay(0);
    setElapsedSec(0);
    setIsRunning(false);
    setIsPaused(false);
  }, [cancelTimerFrame, syncDomDisplay]);

  const setTargetDurationSec = useCallback(
    (sec) => {
      const parsed = Math.max(1, Math.min(7200, Number(sec) || 60));
      targetDurationRef.current = parsed;
      setTargetDurationSecState(parsed);
      syncDomDisplay(getTotalMs());
    },
    [getTotalMs, syncDomDisplay]
  );

  useEffect(() => {
    return () => cancelTimerFrame();
  }, [cancelTimerFrame]);

  const remainingSec = useMemo(() => {
    return targetDurationSec - elapsedSec;
  }, [targetDurationSec, elapsedSec]);

  const progressPct = useMemo(() => {
    if (targetDurationSec <= 0) return 0;
    return Math.min(100, Math.round((elapsedSec / targetDurationSec) * 100));
  }, [elapsedSec, targetDurationSec]);

  const timerStatus = useMemo(() => {
    if (targetDurationSec <= 0) return 'normal';
    const ratio = elapsedSec / targetDurationSec;
    if (ratio > 1) return 'overtime';
    if (ratio >= 0.8) return 'warning';
    return 'normal';
  }, [elapsedSec, targetDurationSec]);

  return {
    targetDurationSec,
    elapsedSec,
    remainingSec,
    progressPct,
    timerStatus,
    isRunning,
    isPaused,
    remainingDisplayRef,
    elapsedDisplayRef,
    progressBarRef,
    getElapsedSec,
    start,
    pause,
    resume,
    reset,
    setTargetDurationSec,
  };
}
