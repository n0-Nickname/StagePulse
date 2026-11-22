import React, { useState } from 'react';
import { Lock, Sparkles, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext.jsx';

function formatDuration(sec) {
  if (sec === null || sec === undefined) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(iso, lang) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function PacingCurveSvg({ timeline }) {
  const points = Array.isArray(timeline) && timeline.length > 0
    ? timeline
    : [
        { sec: 10, wpm: 122 },
        { sec: 20, wpm: 138 },
        { sec: 30, wpm: 145 },
        { sec: 40, wpm: 132 },
      ];

  const width = 320;
  const height = 88;
  const padX = 12;
  const padY = 10;
  const maxWpm = Math.max(180, ...points.map((p) => p.wpm || 0));
  const minWpm = 0;

  const toX = (i) =>
    points.length === 1
      ? width / 2
      : padX + (i / (points.length - 1)) * (width - padX * 2);
  const toY = (wpm) =>
    height - padY - ((wpm - minWpm) / (maxWpm - minWpm || 1)) * (height - padY * 2);

  const polyPoints = points
    .map((p, i) => `${toX(i).toFixed(1)},${toY(p.wpm || 0).toFixed(1)}`)
    .join(' ');

  const optTop = toY(160);
  const optBottom = toY(110);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-24 w-full overflow-visible rounded-lg bg-[#1E1D1B]/80 border border-[#3A3834]"
      role="img"
      aria-label="Pacing curve"
    >
      <rect
        x={padX}
        y={optTop}
        width={width - padX * 2}
        height={Math.max(0, optBottom - optTop)}
        fill="#4A8B6F"
        fillOpacity="0.14"
      />
      <polyline
        fill="none"
        stroke="#D97757"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polyPoints}
      />
      {points.map((p, i) => (
        <circle
          key={`${p.sec}-${i}`}
          cx={toX(i)}
          cy={toY(p.wpm || 0)}
          r="2.8"
          fill="#EAE6DF"
          stroke="#D97757"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}

export default function HistoryTable({
  items = [],
  isPro,
  lockedHistoryCount = 0,
  onUnlockClick,
}) {
  const { lang, t } = useTranslation();
  const [expandedId, setExpandedId] = useState(null);

  const TIMING_BADGES = {
    on_time: {
      label: t('dashboard.onTime'),
      cls: 'bg-[#4A8B6F]/15 text-[#4A8B6F] border-[#4A8B6F]/30',
    },
    under_time: {
      label: t('dashboard.onTime'),
      cls: 'bg-[#D49A42]/15 text-[#D49A42] border-[#D49A42]/30',
    },
    overtime: {
      label: t('dashboard.overtime'),
      cls: 'bg-[#D97757]/15 text-[#D97757] border-[#D97757]/30',
    },
  };

  const PACING_BADGES = {
    optimal: {
      label: t('dashboard.paceOptimal'),
      cls: 'bg-[#4A8B6F]/15 text-[#4A8B6F] border-[#4A8B6F]/30',
    },
    too_slow: {
      label: t('dashboard.paceSlow'),
      cls: 'bg-[#D49A42]/15 text-[#D49A42] border-[#D49A42]/30',
    },
    too_fast: {
      label: t('dashboard.paceFast'),
      cls: 'bg-[#D97757]/15 text-[#D97757] border-[#D97757]/30',
    },
  };

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[#3A3834] bg-[#2A2926] p-10 text-center shadow-sm">
        <Calendar className="mx-auto h-8 w-8 text-[#9E9A92]/60" />
        <h3 className="mt-3 font-editorial text-xl font-semibold text-[#EAE6DF]">
          {t('dashboard.historyTitle')}
        </h3>
        <p className="mt-1 text-sm text-[#9E9A92]">
          {t('dashboard.emptyHistory')}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#3A3834] bg-[#2A2926] shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#3A3834] bg-[#1E1D1B]/60 text-xs font-semibold uppercase tracking-wider text-[#9E9A92]">
              <th className="px-5 py-3.5">{t('dashboard.colTitle')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colDuration')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colStatus')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colWpm')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colPauses')}</th>
              <th className="px-5 py-3.5 text-right">{t('dashboard.colDate')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3A3834]">
            {items.map((item) => {
              const timing = TIMING_BADGES[item.timing_status] || TIMING_BADGES.on_time;
              const pacing = PACING_BADGES[item.pacing_status];
              const locked = !isPro || item.is_analytics_locked;
              const isExpanded = expandedId === item.id;
              const timeline = safeJsonParse(item.pacing_timeline_json, []);
              const fillersObj = safeJsonParse(item.top_fillers_json, {});
              const fillerEntries = Object.entries(fillersObj || {}).sort(
                (a, b) => b[1] - a[1]
              );
              const scoreVal =
                item.score !== null && item.score !== undefined ? item.score : null;

              return (
                <React.Fragment key={item.id}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="cursor-pointer transition-colors hover:bg-[#1E1D1B]/40"
                  >
                    <td className="px-5 py-4 font-medium text-[#EAE6DF]">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-[#9E9A92]" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#9E9A92]" />
                        )}
                        <span>{item.title}</span>
                        {scoreVal !== null && (
                          <span className="ml-1 inline-flex items-center rounded-md border border-[#3A3834] bg-[#1E1D1B] px-1.5 py-0.5 text-[11px] font-semibold text-[#EAE6DF]">
                            {scoreVal}/100
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-[#9E9A92]">
                      {formatDuration(item.actual_duration_sec)}{' '}
                      <span className="text-[#9E9A92]/60">
                        / {formatDuration(item.target_duration_sec)}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${timing.cls}`}
                      >
                        {timing.label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {locked ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUnlockClick?.();
                          }}
                          className="inline-flex items-center gap-1.5 text-xs text-[#9E9A92] hover:text-[#D97757] cursor-pointer"
                        >
                          <span className="blur-[4px] select-none">142</span>
                          <Lock className="h-3 w-3 text-[#D97757]" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[#EAE6DF]">
                            {item.wpm !== null && item.wpm !== undefined
                              ? Math.round(item.wpm)
                              : '—'}
                          </span>
                          {pacing && (
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${pacing.cls}`}
                            >
                              {pacing.label}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {locked ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUnlockClick?.();
                          }}
                          className="inline-flex items-center gap-1.5 text-xs text-[#9E9A92] hover:text-[#D97757] cursor-pointer"
                        >
                          <span className="blur-[4px] select-none">2 (4.1s)</span>
                          <Lock className="h-3 w-3 text-[#D97757]" />
                        </button>
                      ) : (
                        <span className="text-[#EAE6DF]">
                          {item.pause_count ?? 0}{' '}
                          <span className="text-xs text-[#9E9A92]">
                            ({Number(item.total_pause_sec ?? 0).toFixed(1)}{t('common.sec')})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-xs text-[#9E9A92]">
                      {formatDate(item.created_at, lang)}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-[#1E1D1B]/50">
                      <td colSpan={6} className="px-5 py-4">
                        <div className="space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#3A3834] bg-[#2A2926]/80 p-3.5">
                            <div className="space-y-1">
                              <div className="text-xs font-semibold uppercase tracking-wider text-[#9E9A92]">
                                {lang === 'uk' ? 'Вердикт професора' : 'Professor Verdict'}
                              </div>
                              <p className="text-sm text-[#EAE6DF]">
                                {item.verdict || (lang === 'uk' ? 'Немає коментаря.' : 'No verdict recorded.')}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-xs uppercase tracking-wider text-[#9E9A92]">
                                {lang === 'uk' ? 'Оцінка' : 'Score'}
                              </div>
                              <div className="font-editorial text-2xl font-bold text-[#EAE6DF]">
                                {scoreVal !== null ? `${scoreVal}` : '—'}
                                <span className="text-xs font-normal text-[#9E9A92]">/100</span>
                              </div>
                            </div>
                          </div>

                          <div className="relative rounded-xl border border-[#3A3834] bg-[#2A2926]/60 p-3.5">
                            <div
                              className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${
                                locked ? 'blur-[5px] select-none pointer-events-none' : ''
                              }`}
                            >
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9E9A92]">
                                  {lang === 'uk' ? 'Крива темпу (WPM)' : 'Pacing Curve (WPM)'}
                                </div>
                                <PacingCurveSvg timeline={locked ? [] : timeline} />
                              </div>

                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9E9A92]">
                                  {lang === 'uk' ? 'Слова-паразити' : 'Top Filler Words'}
                                  {!locked && item.filler_count !== null && item.filler_count !== undefined && (
                                    <span className="ml-2 text-[#EAE6DF]">({item.filler_count})</span>
                                  )}
                                </div>
                                {fillerEntries.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {fillerEntries.map(([word, count]) => (
                                      <span
                                        key={word}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-[#D97757]/40 bg-[#D97757]/15 px-2.5 py-1 text-xs font-medium text-[#EAE6DF]"
                                      >
                                        <span>{word}</span>
                                        <span className="font-mono text-[#D97757]">×{count}</span>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-[#9E9A92]">
                                    {lang === 'uk'
                                      ? 'Слів-паразитів не виявлено.'
                                      : 'No filler words detected.'}
                                  </p>
                                )}
                              </div>
                            </div>

                            {locked && (
                              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#1E1D1B]/45">
                                <button
                                  type="button"
                                  onClick={onUnlockClick}
                                  className="inline-flex items-center gap-2 rounded-xl bg-[#D97757] hover:bg-[#C46647] px-4 py-2 text-xs font-semibold text-white shadow-md transition-colors cursor-pointer"
                                >
                                  <Sparkles className="h-3.5 w-3.5" />
                                  {t('nav.unlockPro')}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isPro && lockedHistoryCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[#3A3834] bg-[#1E1D1B]/60 px-5 py-4">
          <div className="flex items-center gap-2.5 text-sm text-[#9E9A92]">
            <Lock className="h-4 w-4 text-[#D97757] shrink-0" />
            <span>
              <strong className="font-semibold text-[#EAE6DF]">
                +{lockedHistoryCount}
              </strong>{' '}
              {t('slots.subtitle')}
            </span>
          </div>
          <button
            type="button"
            onClick={onUnlockClick}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#D97757] hover:bg-[#C46647] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('nav.unlockPro')}
          </button>
        </div>
      )}
    </div>
  );
}
