import React, { useState } from 'react';
import { useTranslation } from '../context/LanguageContext.jsx';

const PRESET_MINUTES = [1, 3, 5, 10, 15];

function formatTime(sec) {
  const isNegative = sec < 0;
  const abs = Math.abs(Math.round(sec));
  const mins = Math.floor(abs / 60);
  const secs = abs % 60;
  return `${isNegative ? '-' : ''}${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function TimerControls({
  targetDurationSec,
  elapsedSec,
  remainingSec,
  progressPct,
  timerStatus,
  isRunning,
  isPaused,
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
      ? 'text-[#D97757]'
      : timerStatus === 'warning'
      ? 'text-[#D49A42]'
      : 'text-[#EAE6DF]';

  const barColor =
    timerStatus === 'overtime'
      ? 'bg-[#D97757]'
      : timerStatus === 'warning'
      ? 'bg-[#D49A42]'
      : 'bg-[#4A8B6F]';

  return (
    <div className="rounded-xl bg-[#2A2926] border border-[#3A3834] p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs text-[#9E9A92]">{t('timer.timeRemaining')}</div>
          <div
            className={`mt-1 text-5xl sm:text-6xl font-medium tabular-nums tracking-tight font-['Lora','Newsreader',serif] ${statusColor}`}
          >
            {formatTime(remainingSec)}
          </div>
          <div className="mt-1 text-xs text-[#9E9A92] tabular-nums">
            {t('timer.elapsed')} {formatTime(elapsedSec)} {t('timer.of')} {formatTime(targetDurationSec)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isRunning && !isPaused && (
            <button
              type="button"
              onClick={onStart}
              className="px-5 py-2.5 rounded-lg text-sm font-medium bg-[#D97757] hover:bg-[#C46647] text-white transition-colors cursor-pointer"
            >
              {t('timer.start')}
            </button>
          )}
          {isRunning && (
            <button
              type="button"
              onClick={onPause}
              className="px-5 py-2.5 rounded-lg text-sm font-medium bg-[#1E1D1B] hover:bg-[#3A3834] border border-[#3A3834] text-[#EAE6DF] transition-colors cursor-pointer"
            >
              {t('timer.pause')}
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              onClick={onResume}
              className="px-5 py-2.5 rounded-lg text-sm font-medium bg-[#D97757] hover:bg-[#C46647] text-white transition-colors cursor-pointer"
            >
              {t('timer.resume')}
            </button>
          )}
          {(isRunning || isPaused || elapsedSec > 0) && (
            <>
              <button
                type="button"
                onClick={onFinish}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-[#4A8B6F] hover:bg-[#3E775E] text-white transition-colors cursor-pointer"
              >
                {t('timer.finishAndSave')}
              </button>
              <button
                type="button"
                onClick={onReset}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-[#9E9A92] hover:text-[#EAE6DF] hover:bg-[#1E1D1B] transition-colors cursor-pointer"
              >
                {t('common.reset')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="w-full h-2 rounded-full bg-[#1E1D1B] overflow-hidden border border-[#3A3834]">
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#3A3834]">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESET_MINUTES.map((mins) => {
            const sec = mins * 60;
            return (
              <button
                key={sec}
                type="button"
                disabled={isRunning}
                onClick={() => onSetTargetDuration(sec)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  targetDurationSec === sec
                    ? 'bg-[#D97757]/15 border-[#D97757]/60 text-[#D97757]'
                    : 'bg-[#1E1D1B] border-[#3A3834] text-[#9E9A92] hover:text-[#EAE6DF]'
                }`}
              >
                {t(`timer.presets.${mins}`)}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleCustomSubmit} className="flex items-center gap-2">
          <input
            type="number"
            min="0.5"
            max="120"
            step="0.5"
            disabled={isRunning}
            value={customMin}
            onChange={(e) => setCustomMin(e.target.value)}
            placeholder={t('timer.customMinPlaceholder')}
            className="w-28 rounded-lg bg-[#1E1D1B] border border-[#3A3834] px-2.5 py-1.5 text-xs text-[#EAE6DF] placeholder-[#9E9A92]/60 focus:outline-none focus:border-[#D97757] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isRunning || !customMin}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1E1D1B] border border-[#3A3834] text-[#EAE6DF] hover:bg-[#3A3834] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {t('timer.set')}
          </button>
        </form>
      </div>
    </div>
  );
}
