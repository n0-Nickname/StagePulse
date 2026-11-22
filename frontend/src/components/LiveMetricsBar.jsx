import React from 'react';
import { useTranslation } from '../context/LanguageContext.jsx';

export default function LiveMetricsBar({
  wpm = 0,
  pacingZone = 'warming_up',
  wordCount = 0,
  pauseCount = 0,
  totalPauseSec = 0,
  isSilentPause = false,
  currentSilenceSec = 0,
  estimationMethod = 'speech_api',
}) {
  const { t } = useTranslation();

  const PACING_STATES = {
    warming_up: {
      label: t('metrics.warmingUp'),
      dot: 'bg-[#9E9A92]',
      text: 'text-[#9E9A92]',
    },
    too_slow: {
      label: t('metrics.tooSlow'),
      dot: 'bg-[#D49A42]',
      text: 'text-[#D49A42]',
    },
    optimal: {
      label: t('metrics.optimal'),
      dot: 'bg-[#4A8B6F]',
      text: 'text-[#4A8B6F]',
    },
    too_fast: {
      label: t('metrics.tooFast'),
      dot: 'bg-[#D97757]',
      text: 'text-[#D97757]',
    },
  };

  const pace = PACING_STATES[pacingZone] || PACING_STATES.warming_up;

  return (
    <div className="w-full border border-[#3A3834] bg-[#2A2926] rounded-xl grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#3A3834]">
      <div className="p-4 flex flex-col justify-between gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#9E9A92]">{t('metrics.speakingPace')}</span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${pace.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${pace.dot}`} />
            {pace.label}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-medium text-[#EAE6DF] tabular-nums tracking-tight font-['Lora','Newsreader',serif]">
            {wpm}
          </span>
          <span className="text-xs text-[#9E9A92]">{t('common.wpm')}</span>
        </div>
      </div>

      <div className="p-4 flex flex-col justify-between gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#9E9A92]">{t('metrics.words')}</span>
          <span className="text-xs text-[#9E9A92]/80">
            {estimationMethod === 'speech_api' ? t('metrics.speechApi') : t('metrics.audioBurst')}
          </span>
        </div>
        <div className="text-3xl font-medium text-[#EAE6DF] tabular-nums tracking-tight font-['Lora','Newsreader',serif]">
          {wordCount}
        </div>
      </div>

      <div className="p-4 flex flex-col justify-between gap-2">
        <span className="text-xs text-[#9E9A92]">{t('metrics.longPauses')}</span>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-medium text-[#EAE6DF] tabular-nums tracking-tight font-['Lora','Newsreader',serif]">
            {pauseCount}
          </span>
          <span className="text-xs text-[#9E9A92] tabular-nums">
            {Math.round(totalPauseSec)}{t('common.sec')} {t('metrics.total')}
          </span>
        </div>
      </div>

      <div
        className={`p-4 flex flex-col justify-between gap-2 transition-colors rounded-b-xl sm:rounded-b-none sm:rounded-r-xl ${
          isSilentPause ? 'bg-[#D49A42]/10' : ''
        }`}
      >
        <span className="text-xs text-[#9E9A92]">{t('metrics.microphone')}</span>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isSilentPause ? 'bg-[#D49A42] animate-pulse' : 'bg-[#4A8B6F]'
            }`}
          />
          <span className="text-sm font-medium text-[#EAE6DF] tabular-nums">
            {isSilentPause
              ? `${t('metrics.silent')} (${currentSilenceSec.toFixed(1)}${t('common.sec')})`
              : t('metrics.listening')}
          </span>
        </div>
      </div>
    </div>
  );
}
