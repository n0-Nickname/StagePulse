import React from 'react';
import { Clock, Gauge, PauseCircle, Lock } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext.jsx';

function formatTotalTime(totalSec, t) {
  const minLabel = t('common.min');
  const secLabel = t('common.sec');
  if (!totalSec || totalSec <= 0) return `0${minLabel}`;
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}h ${mins}${minLabel}`;
  if (mins > 0) return `${mins}${minLabel} ${secs}${secLabel}`;
  return `${secs}${secLabel}`;
}

export default function StatsOverview({ stats, isPro, onUnlockClick }) {
  const { t } = useTranslation();
  const totalSessions = stats?.total_sessions ?? 0;
  const totalPracticeSec = stats?.total_practice_sec ?? 0;
  const avgWpm = stats?.avg_wpm;
  const avgPauses = stats?.avg_pauses;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Card 1: Total Practice Time */}
      <div className="rounded-2xl border border-[#3A3834] bg-[#2A2926] p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9E9A92]">
            {t('dashboard.totalTime')}
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D97757]/15 text-[#D97757]">
            <Clock className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-editorial text-3xl font-semibold text-[#EAE6DF]">
            {formatTotalTime(totalPracticeSec, t)}
          </span>
          <span className="text-xs text-[#9E9A92]">
            {t('dashboard.totalSessions')}: {totalSessions}
          </span>
        </div>
      </div>

      {/* Card 2: Average WPM */}
      <div className="relative overflow-hidden rounded-2xl border border-[#3A3834] bg-[#2A2926] p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9E9A92]">
            {t('dashboard.avgWpm')}
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4A8B6F]/15 text-[#4A8B6F]">
            <Gauge className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3">
          {isPro ? (
            <div className="flex items-baseline gap-2">
              <span className="font-editorial text-3xl font-semibold text-[#EAE6DF]">
                {avgWpm !== null && avgWpm !== undefined ? Math.round(avgWpm) : '—'}
              </span>
              <span className="text-xs text-[#9E9A92]">{t('common.wpm')}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onUnlockClick}
              className="group flex items-center gap-2 text-left cursor-pointer"
            >
              <span className="font-editorial text-3xl font-semibold text-[#EAE6DF]/25 blur-[4px] select-none">
                138
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#D97757]/35 bg-[#D97757]/15 px-2.5 py-0.5 text-xs font-medium text-[#D97757] group-hover:bg-[#D97757]/25 transition-colors">
                <Lock className="h-3 w-3" />
                {t('nav.unlockPro')}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Card 3: Average Pauses */}
      <div className="relative overflow-hidden rounded-2xl border border-[#3A3834] bg-[#2A2926] p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9E9A92]">
            {t('dashboard.avgPauses')}
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D97757]/15 text-[#D97757]">
            <PauseCircle className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3">
          {isPro ? (
            <div className="flex items-baseline gap-2">
              <span className="font-editorial text-3xl font-semibold text-[#EAE6DF]">
                {avgPauses !== null && avgPauses !== undefined
                  ? Number(avgPauses).toFixed(1)
                  : '—'}
              </span>
              <span className="text-xs text-[#9E9A92]">&gt;1.5{t('common.sec')}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onUnlockClick}
              className="group flex items-center gap-2 text-left cursor-pointer"
            >
              <span className="font-editorial text-3xl font-semibold text-[#EAE6DF]/25 blur-[4px] select-none">
                2.4
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#D97757]/35 bg-[#D97757]/15 px-2.5 py-0.5 text-xs font-medium text-[#D97757] group-hover:bg-[#D97757]/25 transition-colors">
                <Lock className="h-3 w-3" />
                {t('nav.unlockPro')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
