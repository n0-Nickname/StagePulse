import React, { useState, useEffect, useMemo } from 'react';
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
      <div className="h-28 flex items-center justify-center text-xs text-[#9E9A92] bg-[#1E1D1B] rounded-lg border border-[#3A3834]">
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
      className="w-full h-28 bg-[#1E1D1B] rounded-lg border border-[#3A3834]"
    >
      <polyline
        fill="none"
        stroke="#D97757"
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
            fill="#EAE6DF"
            stroke="#D97757"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
}

function AnnotatedTranscript({ transcript = '', lang = 'uk' }) {
  const parts = useMemo(() => {
    if (!transcript) return [];
    const dict = FILLER_WORDS[lang === 'en' ? 'en' : 'uk'] || FILLER_WORDS.uk;
    const escaped = dict.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'giu');
    return transcript.split(regex);
  }, [transcript, lang]);

  if (!transcript) return null;

  const dictSet = new Set(
    (FILLER_WORDS[lang === 'en' ? 'en' : 'uk'] || FILLER_WORDS.uk).map((w) =>
      w.toLowerCase()
    )
  );

  return (
    <p className="text-xs text-[#EAE6DF] leading-relaxed bg-[#1E1D1B] rounded-lg border border-[#3A3834] p-3 max-h-28 overflow-y-auto">
      {parts.map((part, idx) =>
        dictSet.has(part.toLowerCase()) ? (
          <mark
            key={idx}
            className="bg-[#D97757]/30 text-[#F2A68D] px-1 rounded font-medium"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-['Inter',sans-serif]">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-[#2A2926] border border-[#3A3834] shadow-2xl">
        <div className="px-6 py-4 border-b border-[#3A3834] flex items-center justify-between bg-[#242320] sticky top-0 z-10">
          <h2 className="text-lg font-medium text-[#EAE6DF] font-['Lora','Newsreader',serif]">
            {t('summary.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#9E9A92] hover:text-[#EAE6DF] text-sm px-2 py-1 rounded-md hover:bg-[#1E1D1B] cursor-pointer"
          >
            {t('common.close')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Score & Strict Professor Verdict */}
          <div className="rounded-lg border border-[#3A3834] bg-[#1E1D1B] p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="shrink-0 flex flex-col items-center justify-center px-4 py-2 rounded-lg bg-[#2A2926] border border-[#3A3834]">
              <span className="text-[11px] text-[#9E9A92]">{t('summary.scoreLabel')}</span>
              <span className="text-3xl font-medium text-[#D97757] tabular-nums font-['Lora','Newsreader',serif]">
                {summary.score ?? 0}
                <span className="text-sm text-[#9E9A92]">/100</span>
              </span>
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium text-[#D49A42] mb-1">
                {t('summary.verdictLabel')}
              </div>
              <p className="text-sm text-[#EAE6DF] leading-relaxed">
                {summary.verdict}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 border border-[#3A3834] rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-[#3A3834] bg-[#1E1D1B]">
            <div className="p-3">
              <div className="text-xs text-[#9E9A92]">{t('summary.duration')}</div>
              <div className="mt-1 text-xl font-medium text-[#EAE6DF] tabular-nums font-['Lora','Newsreader',serif]">
                {formatDuration(summary.actualDurationSec)}
              </div>
              <div className="text-[11px] text-[#9E9A92]">
                {t('summary.target')} {formatDuration(summary.targetDurationSec)}
              </div>
            </div>

            <div className="p-3">
              <div className="text-xs text-[#9E9A92]">{t('summary.avgPace')}</div>
              <div className="mt-1 text-xl font-medium text-[#D97757] tabular-nums font-['Lora','Newsreader',serif]">
                {summary.wpm} {t('common.wpm')}
              </div>
            </div>

            <div className="p-3">
              <div className="text-xs text-[#9E9A92]">{t('summary.words')}</div>
              <div className="mt-1 text-xl font-medium text-[#EAE6DF] tabular-nums font-['Lora','Newsreader',serif]">
                {summary.wordCount}
              </div>
            </div>

            <div className="p-3">
              <div className="text-xs text-[#9E9A92]">{t('summary.pauses')}</div>
              <div className="mt-1 text-xl font-medium text-[#EAE6DF] tabular-nums font-['Lora','Newsreader',serif]">
                {summary.pauseCount}
              </div>
              <div className="text-[11px] text-[#9E9A92]">
                {Math.round(summary.totalPauseSec)}{t('common.sec')} {t('metrics.total')}
              </div>
            </div>
          </div>

          {/* PRO-gated Pacing Curve & Filler Words */}
          <div className="relative rounded-lg border border-[#3A3834] bg-[#242320] p-4 space-y-4">
            <div className={!isPro ? 'blur-sm select-none pointer-events-none space-y-4' : 'space-y-4'}>
              <div>
                <div className="text-xs font-medium text-[#9E9A92] mb-2">
                  {t('summary.pacingCurveTitle')}
                </div>
                <PacingCurveChart
                  timeline={summary.pacingTimeline}
                  emptyLabel={t('summary.pacingCurveEmpty')}
                />
              </div>

              <div>
                <div className="text-xs font-medium text-[#9E9A92] mb-2">
                  {t('summary.fillersTitle')} ({summary.fillerCount || 0})
                </div>
                {topFillers.length === 0 ? (
                  <p className="text-xs text-[#4A8B6F]">{t('summary.noFillers')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {topFillers.map(([word, count]) => (
                      <span
                        key={word}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-[#1E1D1B] border border-[#3A3834] text-[#EAE6DF]"
                      >
                        <span>{word}</span>
                        <span className="text-[#D97757] font-semibold">×{count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {summary.transcript && (
                <div>
                  <div className="text-xs font-medium text-[#9E9A92] mb-2">
                    {t('summary.annotatedTranscriptTitle')}
                  </div>
                  <AnnotatedTranscript transcript={summary.transcript} lang={lang} />
                </div>
              )}
            </div>

            {!isPro && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1E1D1B]/60 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-[#EAE6DF] mb-2">
                  {t('summary.proLockedTitle')}
                </p>
                <button
                  type="button"
                  onClick={openSlotModal}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-[#D97757] hover:bg-[#C46647] text-white transition-colors cursor-pointer"
                >
                  {t('summary.proUnlockBtn')}
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#EAE6DF] mb-1.5">
              {t('summary.presentationTitle')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('summary.presentationPlaceholder')}
              className="w-full rounded-lg bg-[#1E1D1B] border border-[#3A3834] px-3.5 py-2 text-sm text-[#EAE6DF] placeholder-[#9E9A92]/60 focus:outline-none focus:border-[#D97757]"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#EAE6DF] mb-1.5">
              {t('summary.notes')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('summary.notesPlaceholder')}
              className="w-full rounded-lg bg-[#1E1D1B] border border-[#3A3834] px-3.5 py-2 text-sm text-[#EAE6DF] placeholder-[#9E9A92]/60 focus:outline-none focus:border-[#D97757] resize-none"
            />
          </div>

          {saveError && (
            <div className="rounded-lg bg-[#D97757]/15 border border-[#D97757] px-3.5 py-2.5 text-sm text-[#F2A68D]">
              {saveError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#3A3834]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[#9E9A92] hover:text-[#EAE6DF] hover:bg-[#1E1D1B] transition-colors cursor-pointer"
            >
              {t('common.discard')}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#D97757] hover:bg-[#C46647] text-white transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? t('common.saving') : t('summary.saveSession')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
