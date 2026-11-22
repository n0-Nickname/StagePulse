import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { FILLER_WORDS } from '../utils/roastGenerator.js';

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function PacingCurveChart({ timeline = [], emptyLabel }) {
  if (!Array.isArray(timeline) || timeline.length < 2) {
    return (
      <div className="h-28 flex items-center justify-center text-xs text-[#9CA3AF] obsidian-inset rounded-xl">
        {emptyLabel}
      </div>
    );
  }

  const width = 420;
  const height = 100;
  const pad = 12;
  const maxWpm = Math.max(180, ...timeline.map((p) => p.wpm || 0));
  const minWpm = 0;

  const points = timeline.map((pt, idx) => {
    const x =
      pad + (idx / Math.max(1, timeline.length - 1)) * (width - pad * 2);
    const y =
      height -
      pad -
      (((pt.wpm || 0) - minWpm) / Math.max(1, maxWpm - minWpm)) *
        (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-28 obsidian-inset rounded-xl"
    >
      <polyline
        fill="none"
        stroke="#FF6363"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
      {timeline.map((pt, idx) => {
        const x =
          pad + (idx / Math.max(1, timeline.length - 1)) * (width - pad * 2);
        const y =
          height -
          pad -
          (((pt.wpm || 0) - minWpm) / Math.max(1, maxWpm - minWpm)) *
            (height - pad * 2);
        return (
          <circle
            key={idx}
            cx={x}
            cy={y}
            r="3"
            fill="#F4F5F7"
            stroke="#FF6363"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

function AnnotatedTranscript({ transcript, lang = 'en' }) {
  const dict = FILLER_WORDS[lang === 'uk' ? 'uk' : 'en'];
  const parts = useMemo(() => {
    const escaped = dict.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'giu');
    return transcript.split(regex);
  }, [transcript, dict]);

  const dictSet = new Set(dict.map((w) => w.toLowerCase()));

  return (
    <p className="text-xs text-[#F4F5F7] leading-relaxed obsidian-inset rounded-xl p-3 max-h-28 overflow-y-auto">
      {parts.map((part, idx) =>
        dictSet.has(part.toLowerCase()) ? (
          <mark
            key={idx}
            className="bg-[#FF6363]/25 text-[#FCA5A5] px-1 rounded font-medium"
          >
            {part}
          </mark>
        ) : (
          <span key={idx}>{part}</span>
        )
      )}
    </p>
  );
}

export default function SessionSummaryModal({
  isOpen,
  onClose,
  onSave,
  summary,
  isSaving = false,
  saveError = null,
}) {
  const { lang, t } = useTranslation();
  const { user, openSlotModal } = useAuth();
  const isPro = Boolean(user?.is_pro);

  const [title, setTitle] = useState(summary?.defaultTitle || t('summary.defaultTitle'));
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (summary?.defaultTitle) {
      setTitle(summary.defaultTitle);
    }
  }, [summary?.defaultTitle]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isSaving) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen || !summary) return null;

  const topFillers = Object.entries(summary.fillerBreakdown || {}).sort(
    (a, b) => b[1] - a[1]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      title: title.trim() || t('summary.defaultTitle'),
      notes: notes.trim() || null,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-modal-title"
      className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
    >
      <div className="modal-spring-in w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl obsidian-glass shadow-2xl">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between bg-[#0B0C10]/90 sticky top-0 z-10 backdrop-blur-md">
          <h2 id="summary-modal-title" className="text-lg font-semibold text-[#F4F5F7]">
            {t('summary.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#F4F5F7] text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-white/[0.06] cursor-pointer transition-colors"
          >
            {t('common.close')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Score & Strict Professor Verdict */}
          <div className="rounded-xl obsidian-inset p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="shrink-0 flex flex-col items-center justify-center px-4 py-2.5 rounded-xl bg-[#121317] border border-white/[0.08]">
              <span className="text-[11px] uppercase tracking-wider text-[#9CA3AF]">
                {t('summary.scoreLabel')}
              </span>
              <span className="text-3xl font-bold font-mono text-[#FF6363] tabular-nums">
                {summary.score ?? 0}
                <span className="text-sm text-[#9CA3AF]">/100</span>
              </span>
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#F59E0B] mb-1">
                {t('summary.verdictLabel')}
              </div>
              <p className="text-sm text-[#F4F5F7] leading-relaxed">
                {summary.verdict}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 obsidian-inset rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08]">
            <div className="p-3.5">
              <div className="text-xs text-[#9CA3AF]">{t('summary.duration')}</div>
              <div className="mt-1 text-xl font-bold font-mono text-[#F4F5F7] tabular-nums">
                {formatDuration(summary.actualDurationSec)}
              </div>
              <div className="text-[11px] font-mono text-[#9CA3AF]">
                {t('summary.target')} {formatDuration(summary.targetDurationSec)}
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-xs text-[#9CA3AF]">{t('summary.avgPace')}</div>
              <div className="mt-1 text-xl font-bold font-mono text-[#FF6363] tabular-nums">
                {summary.wpm} <span className="text-xs font-normal text-[#9CA3AF]">{t('common.wpm')}</span>
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-xs text-[#9CA3AF]">{t('summary.words')}</div>
              <div className="mt-1 text-xl font-bold font-mono text-[#F4F5F7] tabular-nums">
                {summary.wordCount}
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-xs text-[#9CA3AF]">{t('summary.pauses')}</div>
              <div className="mt-1 text-xl font-bold font-mono text-[#F4F5F7] tabular-nums">
                {summary.pauseCount}
              </div>
              <div className="text-[11px] font-mono text-[#9CA3AF]">
                {Math.round(summary.totalPauseSec)}{t('common.sec')} {t('metrics.total')}
              </div>
            </div>
          </div>

          {/* PRO-gated Pacing Curve & Filler Words */}
          <div className="relative rounded-xl obsidian-inset p-4 space-y-4">
            <div className={!isPro ? 'blur-sm select-none pointer-events-none space-y-4' : 'space-y-4'}>
              <div>
                <div className="text-xs font-medium text-[#9CA3AF] mb-2">
                  {t('summary.pacingCurveTitle')}
                </div>
                <PacingCurveChart
                  timeline={summary.pacingTimeline}
                  emptyLabel={t('summary.pacingCurveEmpty')}
                />
              </div>

              <div>
                <div className="text-xs font-medium text-[#9CA3AF] mb-2">
                  {t('summary.fillersTitle')} ({summary.fillerCount || 0})
                </div>
                {topFillers.length === 0 ? (
                  <p className="text-xs text-[#10B981]">{t('summary.noFillers')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {topFillers.map(([word, count]) => (
                      <span
                        key={word}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-[#121317] border border-white/[0.08] text-[#F4F5F7]"
                      >
                        <span>{word}</span>
                        <span className="font-mono text-[#FF6363] font-semibold">×{count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {summary.transcript && (
                <div>
                  <div className="text-xs font-medium text-[#9CA3AF] mb-2">
                    {t('summary.annotatedTranscriptTitle')}
                  </div>
                  <AnnotatedTranscript transcript={summary.transcript} lang={lang} />
                </div>
              )}
            </div>

            {!isPro && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07080A]/65 rounded-xl p-4 text-center backdrop-blur-[2px]">
                <p className="text-sm font-semibold text-[#F4F5F7] mb-2.5">
                  {t('summary.proLockedTitle')}
                </p>
                <button
                  type="button"
                  onClick={openSlotModal}
                  className="crimson-glow-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('summary.proUnlockBtn')}
                </button>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="summary-title-input"
              className="block text-xs font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5"
            >
              {t('summary.presentationTitle')}
            </label>
            <input
              id="summary-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('summary.presentationPlaceholder')}
              className="w-full rounded-xl obsidian-inset px-3.5 py-2.5 text-sm text-[#F4F5F7] placeholder-[#6B7280] focus:outline-none focus:border-[#FF6363]"
              required
            />
          </div>

          <div>
            <label
              htmlFor="summary-notes-input"
              className="block text-xs font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5"
            >
              {t('summary.notes')}
            </label>
            <textarea
              id="summary-notes-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('summary.notesPlaceholder')}
              className="w-full rounded-xl obsidian-inset px-3.5 py-2.5 text-sm text-[#F4F5F7] placeholder-[#6B7280] focus:outline-none focus:border-[#FF6363] resize-none"
            />
          </div>

          {saveError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl bg-[#FF6363]/12 border border-[#FF6363]/60 px-3.5 py-2.5 text-xs font-medium text-[#FCA5A5]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-[#FF6363]" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl text-sm font-medium text-[#9CA3AF] hover:text-[#F4F5F7] hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              {t('common.discard')}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="crimson-glow-btn px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? t('common.saving') : t('summary.saveSession')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
