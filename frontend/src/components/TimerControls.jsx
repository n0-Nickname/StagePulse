import React, { memo, useState } from 'react';
import { Play, Pause, RotateCcw, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext.jsx';
import { formatTime } from '../hooks/useTimer.js';

const PRESET_MINUTES = [1, 3, 5, 10];

function TimerControls({
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
  onStart,
  onPause,
  onResume,
  onReset,
  onFinish,
  onSetTargetDuration,
}) {
  const { t } = useTranslation();
  const [customMin, setCustomMin] = useState('');

  const handleCustomSubmit = (e) => {
    e.preventDefault();
    const mins = parseFloat(customMin);
    if (!Number.isNaN(mins) && mins > 0) {
      onSetTargetDuration(Math.round(mins * 60));
      setCustomMin('');
    }
  };

  const statusColor =
    timerStatus === 'overtime'
      ? 'text-[#FF6363]'
      : timerStatus === 'warning'
      ? 'text-[#F59E0B]'
      : 'text-[#F4F5F7]';

  const barColor =
    timerStatus === 'overtime'
      ? 'bg-[#FF6363] shadow-[0_0_16px_rgba(255,99,99,0.5)]'
      : timerStatus === 'warning'
      ? 'bg-[#F59E0B] shadow-[0_0_14px_rgba(245,158,11,0.4)]'
      : 'bg-[#10B981] shadow-[0_0_14px_rgba(16,185,129,0.35)]';

  const progressScale = Math.min(1, Math.max(0, (progressPct || 0) / 100));

  return (
    <div className="obsidian-glass rounded-2xl p-3 sm:p-6 space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-[#9CA3AF]">
            {t('timer.timeRemaining')}
          </div>
          <div
            ref={remainingDisplayRef}
            data-testid="timer-display"
            className={`mt-1.5 text-5xl sm:text-6xl font-bold font-mono tabular-nums tracking-tight ${statusColor}`}
          >
            {formatTime(remainingSec)}
          </div>
          <div className="mt-1.5 text-xs font-mono text-[#9CA3AF] tabular-nums">
            {t('timer.elapsed')}{' '}
            <span ref={elapsedDisplayRef} data-testid="timer-elapsed-display">
              {formatTime(elapsedSec)}
            </span>{' '}
            {t('timer.of')} {formatTime(targetDurationSec)}
          </div>
        </div>

        {/* Sticky bottom thumb-friendly controls on mobile (360px-430px), inline on sm+ */}
        <div
          data-testid="timer-action-bar"
          className="fixed bottom-0 inset-x-0 z-30 flex flex-wrap items-center justify-center sm:justify-end gap-2 sm:gap-2.5 px-3 py-3 bg-[#07080A]/92 backdrop-blur-md border-t border-white/[0.08] sm:static sm:p-0 sm:bg-transparent sm:backdrop-blur-none sm:border-t-0"
        >
          {!isRunning && !isPaused && (
            <button
              type="button"
              onClick={onStart}
              className="crimson-glow-btn flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
            >
              <Play className="h-4 w-4 fill-current" />
              {t('timer.start')}
            </button>
          )}
          {isRunning && (
            <button
              type="button"
              onClick={onPause}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl text-sm font-medium obsidian-inset hover:bg-white/[0.06] text-[#F4F5F7] transition-colors cursor-pointer"
            >
              <Pause className="h-4 w-4" />
              {t('timer.pause')}
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              onClick={onResume}
              className="crimson-glow-btn flex-1 sm:flex-none inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
            >
              <Play className="h-4 w-4 fill-current" />
              {t('timer.resume')}
            </button>
          )}
          {(isRunning || isPaused || elapsedSec > 0) && (
            <>
              <button
                type="button"
                onClick={onFinish}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 min-h-[48px] px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#10B981] hover:bg-[#059669] text-white shadow-[0_0_18px_rgba(16,185,129,0.3)] transition-colors cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t('timer.finishAndSave')}
              </button>
              <button
                type="button"
                onClick={onReset}
                className="inline-flex items-center justify-center gap-1.5 min-h-[48px] px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#9CA3AF] hover:text-[#F4F5F7] hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('common.reset')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="w-full h-2 rounded-full obsidian-inset overflow-hidden">
        <div
          ref={progressBarRef}
          className={`h-full w-full origin-left transition-colors duration-300 ${barColor}`}
          style={{ transform: `scaleX(${progressScale})` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {PRESET_MINUTES.map((mins) => {
            const sec = mins * 60;
            const active = targetDurationSec === sec;
            return (
              <button
                key={sec}
                type="button"
                disabled={isRunning}
                onClick={() => onSetTargetDuration(sec)}
                className={`flex-1 sm:flex-none min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  active
                    ? 'bg-[#FF6363]/15 border-[#FF6363]/60 text-[#FF6363]'
                    : 'obsidian-inset text-[#9CA3AF] hover:text-[#F4F5F7]'
                }`}
              >
                {t(`timer.presets.${mins}`)}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleCustomSubmit} className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="number"
            min="0.5"
            max="120"
            step="0.5"
            disabled={isRunning}
            value={customMin}
            onChange={(e) => setCustomMin(e.target.value)}
            placeholder={t('timer.customMinPlaceholder')}
            aria-label={t('timer.customMinPlaceholder')}
            className="flex-1 min-w-0 sm:flex-none sm:w-28 min-h-[44px] rounded-lg obsidian-inset px-2.5 py-1.5 text-xs font-mono text-[#F4F5F7] placeholder-[#6B7280] focus:outline-none focus:border-[#FF6363] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isRunning || !customMin}
            className="min-h-[44px] px-3.5 py-1.5 rounded-lg text-xs font-medium obsidian-inset text-[#F4F5F7] hover:bg-white/[0.08] disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed transition-colors"
          >
            {t('timer.set')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default memo(TimerControls);
