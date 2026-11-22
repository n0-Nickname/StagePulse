import React, { useState } from 'react';
import { Lock, Sparkles, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext.jsx';

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
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
      className="h-24 w-full overflow-visible rounded-xl obsidian-inset"
      role="img"
      aria-label="Pacing curve"
    >
      <rect
        x={padX}
        y={optTop}
        width={width - padX * 2}
        height={Math.max(0, optBottom - optTop)}
        fill="#10B981"
        fillOpacity="0.14"
      />
      <polyline
        fill="none"
        stroke="#FF6363"
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
          fill="#F4F5F7"
          stroke="#FF6363"
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
      cls: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30',
    },
    under_time: {
      label: t('dashboard.onTime'),
      cls: 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30',
    },
    overtime: {
      label: t('dashboard.overtime'),
      cls: 'bg-[#FF6363]/15 text-[#FF6363] border-[#FF6363]/30',
    },
  };

  const PACING_BADGES = {
    optimal: {
      label: t('dashboard.paceOptimal'),
      cls: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30',
    },
    too_slow: {
      label: t('dashboard.paceSlow'),
      cls: 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30',
    },
    too_fast: {
      label: t('dashboard.paceFast'),
      cls: 'bg-[#FF6363]/15 text-[#FF6363] border-[#FF6363]/30',
    },
  };

  if (items.length === 0) {
    return (
      <div className="obsidian-glass rounded-2xl p-10 text-center shadow-lg">
        <Calendar className="mx-auto h-8 w-8 text-[#9CA3AF]/60" />
        <h3 className="mt-3 text-xl font-semibold text-[#F4F5F7]">
          {t('dashboard.historyTitle')}
        </h3>
        <p className="mt-1 text-sm text-[#9CA3AF]">
          {t('dashboard.emptyHistory')}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl obsidian-glass shadow-lg">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-[#0B0C10]/70 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
              <th className="px-5 py-3.5">{t('dashboard.colTitle')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colDuration')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colStatus')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colWpm')}</th>
              <th className="px-4 py-3.5">{t('dashboard.colPauses')}</th>
              <th className="px-5 py-3.5 text-right">{t('dashboard.colDate')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.08]">
            {items.map((item, idx) => {
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
                    style={{ '--stagger-index': idx + 3 }}
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="stagger-item cursor-pointer transition-colors hover:bg-white/[0.04]"
                  >
                    <td className="px-5 py-4 font-medium text-[#F4F5F7]">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
                        )}
                        <span>{item.title}</span>
                        {scoreVal !== null && (
                          <span className="ml-1 inline-flex items-center rounded-md border border-white/[0.08] bg-[#0B0C10] px-1.5 py-0.5 text-[11px] font-mono font-semibold text-[#F4F5F7]">
                            {scoreVal}/100
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-[#9CA3AF]">
                      {formatDuration(item.actual_duration_sec)}{' '}
                      <span className="text-[#6B7280]">
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
                          className="inline-flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-[#FF6363] cursor-pointer"
                        >
                          <span className="font-mono blur-[4px] select-none">142</span>
                          <Lock className="h-3 w-3 text-[#FF6363]" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-[#F4F5F7]">
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
                          className="inline-flex items-center gap-1.5 text-xs text-[#9CA3AF] hover:text-[#FF6363] cursor-pointer"
                        >
                          <span className="font-mono blur-[4px] select-none">2 (4.1s)</span>
                          <Lock className="h-3 w-3 text-[#FF6363]" />
                        </button>
                      ) : (
                        <span className="font-mono text-[#F4F5F7]">
                          {item.pause_count ?? 0}{' '}
                          <span className="text-xs text-[#9CA3AF]">
                            ({Number(item.total_pause_sec ?? 0).toFixed(1)}{t('common.sec')})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-xs text-[#9CA3AF]">
                      {formatDate(item.created_at, lang)}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-[#0B0C10]/65">
                      <td colSpan={6} className="px-5 py-4">
                        <div className="space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#121317]/90 p-3.5">
                            <div className="space-y-1">
                              <div className="text-xs font-semibold uppercase tracking-wider text-[#F59E0B]">
                                {t('dashboard.verdictTitle')}
                              </div>
                              <p className="text-sm text-[#F4F5F7]">
                                {item.verdict || t('dashboard.noVerdict')}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-xs uppercase tracking-wider text-[#9CA3AF]">
                                {t('dashboard.scoreTitle')}
                              </div>
                              <div className="font-mono text-2xl font-bold text-[#FF6363]">
                                {scoreVal !== null ? `${scoreVal}` : '—'}
                                <span className="text-xs font-normal text-[#9CA3AF]">/100</span>
                              </div>
                            </div>
                          </div>

                          <div className="relative rounded-xl border border-white/[0.08] bg-[#121317]/75 p-3.5">
                            <div
                              className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${
                                locked ? 'blur-[5px] select-none pointer-events-none' : ''
                              }`}
                            >
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
                                  {t('dashboard.pacingCurveTitle')}
                                </div>
                                <PacingCurveSvg timeline={locked ? [] : timeline} />
                              </div>

                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
                                  {t('dashboard.fillersTitle')}
                                  {!locked && item.filler_count !== null && item.filler_count !== undefined && (
                                    <span className="ml-2 font-mono text-[#F4F5F7]">({item.filler_count})</span>
                                  )}
                                </div>
                                {fillerEntries.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {fillerEntries.map(([word, count]) => (
                                      <span
                                        key={word}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-[#FF6363]/40 bg-[#FF6363]/15 px-2.5 py-1 text-xs font-medium text-[#F4F5F7]"
                                      >
                                        <span>{word}</span>
                                        <span className="font-mono text-[#FF6363]">×{count}</span>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-[#10B981]">
                                    {t('dashboard.noFillers')}
                                  </p>
                                )}
                              </div>
                            </div>

                            {locked && (
                              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#07080A]/55 backdrop-blur-[2px]">
                                <button
                                  type="button"
                                  onClick={onUnlockClick}
                                  className="crimson-glow-btn inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
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
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/[0.08] bg-[#0B0C10]/70 px-5 py-4">
          <div className="flex items-center gap-2.5 text-sm text-[#9CA3AF]">
            <Lock className="h-4 w-4 text-[#FF6363] shrink-0" />
            <span>
              <strong className="font-mono font-semibold text-[#F4F5F7]">
                +{lockedHistoryCount}
              </strong>{' '}
              {t('slots.subtitle')}
            </span>
          </div>
          <button
            type="button"
            onClick={onUnlockClick}
            className="crimson-glow-btn inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('nav.unlockPro')}
          </button>
        </div>
      )}
    </div>
  );
}
