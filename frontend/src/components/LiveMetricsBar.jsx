import React, { memo } from 'react';
import { useTranslation } from '../context/LanguageContext.jsx';

function LiveMetricsBar({
  wpm = 0,
  rollingWpm = 0,
  pacingZone = 'warming_up',
  wordCount = 0,
  pauseCount = 0,
  totalPauseSec = 0,
  fillerCount = 0,
  isSilentPause = false,
  currentSilenceSec = 0,
  estimationMethod = 'speech_api',
}) {
  const { t } = useTranslation();

  const PACING_STATES = {
    warming_up: {
      label: t('metrics.warmingUp'),
      dot: 'bg-[#9CA3AF]',
      text: 'text-[#9CA3AF]',
    },
    too_slow: {
      label: t('metrics.tooSlow'),
      dot: 'bg-[#F59E0B]',
      text: 'text-[#F59E0B]',
    },
    optimal: {
      label: t('metrics.optimal'),
      dot: 'bg-[#10B981]',
      text: 'text-[#10B981]',
    },
    too_fast: {
      label: t('metrics.tooFast'),
      dot: 'bg-[#FF6363]',
      text: 'text-[#FF6363]',
    },
  };

  const pace = PACING_STATES[pacingZone] || PACING_STATES.warming_up;

  return (
    <div className="w-full obsidian-glass rounded-2xl grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08]">
      <div className="p-4 flex flex-col justify-between gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#9CA3AF]">{t('metrics.speakingPace')}</span>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${pace.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${pace.dot}`} />
            {pace.label}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span
            data-testid="live-wpm-value"
            className="text-3xl font-bold font-mono text-[#F4F5F7] tabular-nums tracking-tight"
          >
            {wpm}
          </span>
          <span className="text-xs font-mono text-[#9CA3AF]">{t('common.wpm')}</span>
          {rollingWpm > 0 && (
            <span
              data-testid="rolling-wpm-value"
              className="ml-auto text-[11px] font-mono text-[#C4B5FD] tabular-nums"
            >
              15s: {rollingWpm}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 flex flex-col justify-between gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#9CA3AF]">{t('metrics.words')}</span>
          <span className="text-[11px] font-mono text-[#8B5CF6]">
            {estimationMethod === 'speech_api' ? t('metrics.speechApi') : t('metrics.audioBurst')}
          </span>
        </div>
        <div className="text-3xl font-bold font-mono text-[#F4F5F7] tabular-nums tracking-tight">
          {wordCount}
        </div>
      </div>

      <div className="p-4 flex flex-col justify-between gap-2">
        <span className="text-xs text-[#9CA3AF]">{t('metrics.longPauses')}</span>
        <div className="flex items-baseline gap-2">
          <span
            data-testid="live-pause-count"
            className="text-3xl font-bold font-mono text-[#F4F5F7] tabular-nums tracking-tight"
          >
            {pauseCount}
          </span>
          <span className="text-xs font-mono text-[#9CA3AF] tabular-nums">
            {Math.round(totalPauseSec)}{t('common.sec')} {t('metrics.total')}
          </span>
        </div>
      </div>

      <div className="p-4 flex flex-col justify-between gap-2">
        <span className="text-xs text-[#9CA3AF]">{t('metrics.fillers')}</span>
        <div className="flex items-baseline gap-2">
          <span
            data-testid="live-filler-count"
            className={`text-3xl font-bold font-mono tabular-nums tracking-tight ${
              fillerCount > 0 ? 'text-[#FF6363]' : 'text-[#10B981]'
            }`}
          >
            {fillerCount}
          </span>
        </div>
      </div>

      <div
        className={`col-span-2 sm:col-span-1 p-4 flex flex-col justify-between gap-2 transition-colors rounded-b-2xl sm:rounded-b-none sm:rounded-r-2xl ${
          isSilentPause ? 'bg-[#F59E0B]/10' : ''
        }`}
      >
        <span className="text-xs text-[#9CA3AF]">{t('metrics.microphone')}</span>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isSilentPause ? 'bg-[#F59E0B] animate-pulse' : 'bg-[#10B981]'
            }`}
          />
          <span className="text-sm font-mono font-medium text-[#F4F5F7] tabular-nums">
            {isSilentPause
              ? `${t('metrics.silent')} (${currentSilenceSec.toFixed(1)}${t('common.sec')})`
              : t('metrics.listening')}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(LiveMetricsBar);
