import { useState, useRef, useEffect, useCallback, useMemo } from 'react';

export function useTimer(initialTargetSec = 180) {
  const [targetDurationSec, setTargetDurationSecState] = useState(initialTargetSec);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const startWallMsRef = useRef(null);
  const accumulatedMsRef = useRef(0);
  const intervalIdRef = useRef(null);

  const clearTimerInterval = useCallback(() => {
    if (intervalIdRef.current !== null) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
  }, []);

  const syncElapsed = useCallback(() => {
    if (startWallMsRef.current === null) return;
    const now = performance.now();
    const totalMs = accumulatedMsRef.current + (now - startWallMsRef.current);
    setElapsedSec(Math.floor(totalMs / 1000));
  }, []);

  const start = useCallback(() => {
    clearTimerInterval();
    accumulatedMsRef.current = 0;
    startWallMsRef.current = performance.now();
    setElapsedSec(0);
    setIsRunning(true);
    setIsPaused(false);
    intervalIdRef.current = setInterval(syncElapsed, 100);
  }, [clearTimerInterval, syncElapsed]);

  const pause = useCallback(() => {
    if (startWallMsRef.current !== null) {
      accumulatedMsRef.current += performance.now() - startWallMsRef.current;
      startWallMsRef.current = null;
    }
    clearTimerInterval();
    setElapsedSec(Math.floor(accumulatedMsRef.current / 1000));
    setIsRunning(false);
    setIsPaused(true);
  }, [clearTimerInterval]);

  const resume = useCallback(() => {
    clearTimerInterval();
    startWallMsRef.current = performance.now();
    setIsRunning(true);
    setIsPaused(false);
    intervalIdRef.current = setInterval(syncElapsed, 100);
  }, [clearTimerInterval, syncElapsed]);

  const reset = useCallback(() => {
    clearTimerInterval();
    startWallMsRef.current = null;
    accumulatedMsRef.current = 0;
    setElapsedSec(0);
    setIsRunning(false);
    setIsPaused(false);
  }, [clearTimerInterval]);

  const setTargetDurationSec = useCallback((sec) => {
    const parsed = Math.max(1, Math.min(7200, Number(sec) || 60));
    setTargetDurationSecState(parsed);
  }, []);

  useEffect(() => {
    return () => clearTimerInterval();
  }, [clearTimerInterval]);

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
    start,
    pause,
    resume,
    reset,
    setTargetDurationSec,
  };
}
