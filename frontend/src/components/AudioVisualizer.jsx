import React from 'react';
import { useTranslation } from '../context/LanguageContext.jsx';

export default function AudioVisualizer({
  frequencyBars = [],
  rmsLevel = 0,
  isSilentPause = false,
  isRunning = false,
  noiseThreshold = 0.045,
  onChangeThreshold,
  speechLang = 'uk-UA',
  onChangeSpeechLang,
}) {
  const { t } = useTranslation();

  return (
    <div className="obsidian-glass rounded-2xl p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              !isRunning
                ? 'bg-[#4B5563]'
                : isSilentPause
                ? 'bg-[#F59E0B] animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.6)]'
                : 'bg-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.6)]'
            }`}
          />
          <span className="text-sm font-medium text-[#F4F5F7]">
            {!isRunning
              ? t('audio.micIdle')
              : isSilentPause
              ? t('audio.silenceDetected')
              : t('audio.voiceActive')}
          </span>
          <span className="text-xs font-mono text-[#9CA3AF] tabular-nums">
            RMS {rmsLevel.toFixed(3)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {onChangeSpeechLang && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="speech-lang-select"
                className="text-xs font-medium text-[#9CA3AF] whitespace-nowrap"
              >
                {t('audio.speechLangLabel')}
              </label>
              <select
                id="speech-lang-select"
                value={speechLang}
                onChange={(e) => onChangeSpeechLang(e.target.value)}
                className="rounded-lg obsidian-inset px-2.5 py-1 text-xs text-[#F4F5F7] focus:outline-none focus:border-[#FF6363] cursor-pointer"
              >
                <option value="uk-UA">{t('audio.speechLangUk')}</option>
                <option value="en-US">{t('audio.speechLangEn')}</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-3">
            <label
              htmlFor="noise-gate-slider"
              className="text-xs font-mono text-[#9CA3AF] whitespace-nowrap"
            >
              {t('audio.noiseGate')} ({noiseThreshold.toFixed(3)})
            </label>
            <input
              id="noise-gate-slider"
              type="range"
              min="0.010"
              max="0.150"
              step="0.005"
              value={noiseThreshold}
              onChange={(e) => onChangeThreshold?.(parseFloat(e.target.value))}
              className="w-32 accent-[#FF6363] cursor-pointer"
            />
          </div>
        </div>
      </div>

      <div className="h-24 flex items-end justify-between gap-1.5 px-3 py-2.5 rounded-xl obsidian-inset">
        {frequencyBars.map((val, idx) => {
          const heightPct = Math.max(8, Math.min(100, Math.round(val * 100)));
          const barColor = !isRunning
            ? 'bg-white/[0.12]'
            : isSilentPause
            ? 'bg-[#F59E0B]/75'
            : 'bg-gradient-to-t from-[#FF6363] to-[#8B5CF6]';
          return (
            <div
              key={idx}
              className={`flex-1 rounded-full transition-all duration-75 ${barColor}`}
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}
