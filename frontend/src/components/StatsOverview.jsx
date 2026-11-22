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
      <div
        style={{ '--stagger-index': 0 }}
        className="stagger-item obsidian-glass rounded-2xl p-5 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('dashboard.totalTime')}
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF6363]/15 border border-[#FF6363]/30 text-[#FF6363]">
            <Clock className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2.5">
          <span className="font-mono text-3xl font-bold text-[#F4F5F7] tabular-nums">
            {formatTotalTime(totalPracticeSec, t)}
          </span>
          <span className="text-xs font-mono text-[#9CA3AF]">
            {t('dashboard.totalSessions')}: {totalSessions}
          </span>
        </div>
      </div>

      {/* Card 2: Average WPM */}
      <div
        style={{ '--stagger-index': 1 }}
        className="stagger-item relative overflow-hidden obsidian-glass rounded-2xl p-5 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('dashboard.avgWpm')}
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#10B981]/15 border border-[#10B981]/30 text-[#10B981]">
            <Gauge className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3">
          {isPro ? (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold text-[#F4F5F7] tabular-nums">
                {avgWpm !== null && avgWpm !== undefined ? Math.round(avgWpm) : '—'}
              </span>
              <span className="text-xs font-mono text-[#9CA3AF]">{t('common.wpm')}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onUnlockClick}
              className="group flex items-center gap-2.5 text-left cursor-pointer"
            >
              <span className="font-mono text-3xl font-bold text-[#F4F5F7]/20 blur-[5px] select-none">
                138
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#FF6363]/40 bg-[#FF6363]/15 px-2.5 py-0.5 text-xs font-medium text-[#FCA5A5] group-hover:bg-[#FF6363]/25 transition-colors">
                <Lock className="h-3 w-3 text-[#FF6363]" />
                {t('nav.unlockPro')}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Card 3: Average Pauses */}
      <div
        style={{ '--stagger-index': 2 }}
        className="stagger-item relative overflow-hidden obsidian-glass rounded-2xl p-5 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('dashboard.avgPauses')}
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 text-[#A78BFA]">
            <PauseCircle className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3">
          {isPro ? (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl font-bold text-[#F4F5F7] tabular-nums">
                {avgPauses !== null && avgPauses !== undefined
                  ? Number(avgPauses).toFixed(1)
                  : '—'}
              </span>
              <span className="text-xs font-mono text-[#9CA3AF]">&gt;1.5{t('common.sec')}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onUnlockClick}
              className="group flex items-center gap-2.5 text-left cursor-pointer"
            >
              <span className="font-mono text-3xl font-bold text-[#F4F5F7]/20 blur-[5px] select-none">
                2.4
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#FF6363]/40 bg-[#FF6363]/15 px-2.5 py-0.5 text-xs font-medium text-[#FCA5A5] group-hover:bg-[#FF6363]/25 transition-colors">
                <Lock className="h-3 w-3 text-[#FF6363]" />
                {t('nav.unlockPro')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
