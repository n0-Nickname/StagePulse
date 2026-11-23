import React, { memo, useEffect, useRef } from 'react';
import { useTranslation } from '../context/LanguageContext.jsx';

function AudioVisualizer({
  frequencyBars = [],
  rmsLevel = 0,
  rmsRef = null,
  barsRef = null,
  isSilentPause = false,
  isRunning = false,
  noiseThreshold = 0.045,
  onChangeThreshold,
  speechLang = 'uk-UA',
  onChangeSpeechLang,
}) {
  const { t } = useTranslation();
  const barElsRef = useRef([]);
  const rmsTextRef = useRef(null);

  useEffect(() => {
    if (!barsRef && !rmsRef) {
      if (rmsTextRef.current) {
        rmsTextRef.current.textContent = `RMS ${Number(rmsLevel || 0).toFixed(3)}`;
      }
      return undefined;
    }

    if (!isRunning) {
      for (const el of barElsRef.current) {
        if (el) el.style.transform = 'scaleY(0.08)';
      }
      if (rmsTextRef.current) {
        rmsTextRef.current.textContent = 'RMS 0.000';
      }
      return undefined;
    }

    let rafId = 0;
    const renderFrame = () => {
      const bars = barsRef?.current;
      if (bars) {
        for (let i = 0; i < bars.length; i += 1) {
          const el = barElsRef.current[i];
          if (el) {
            const scale = Math.max(0.08, Math.min(1, Number(bars[i] ?? 0.05)));
            el.style.transform = `scaleY(${scale})`;
          }
        }
      }
      if (rmsRef && rmsTextRef.current) {
        rmsTextRef.current.textContent = `RMS ${Number(rmsRef.current || 0).toFixed(3)}`;
      }
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [isRunning, barsRef, rmsRef, rmsLevel]);

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
          <span
            ref={rmsTextRef}
            data-testid="audio-rms-value"
            className="text-xs font-mono text-[#9CA3AF] tabular-nums"
          >
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
          const scale = Math.max(0.08, Math.min(1, Number(val ?? 0.05)));
          const barColor = !isRunning
            ? 'bg-white/[0.12]'
            : isSilentPause
            ? 'bg-[#F59E0B]/75'
            : 'bg-gradient-to-t from-[#FF6363] to-[#8B5CF6]';
          return (
            <div
              key={idx}
              ref={(el) => {
                barElsRef.current[idx] = el;
              }}
              data-testid="audio-meter-bar"
              className={`flex-1 h-full origin-bottom rounded-full will-change-transform ${barColor}`}
              style={{ transform: `scaleY(${scale})` }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default memo(AudioVisualizer);
