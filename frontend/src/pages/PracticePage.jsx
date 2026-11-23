import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cpu, AlertCircle } from 'lucide-react';
import { useTimer } from '../hooks/useTimer.js';
import { useSpeechAnalytics } from '../hooks/useSpeechAnalytics.js';
import { useTranslation } from '../context/LanguageContext.jsx';
import { presentationsApi, formatApiError } from '../api/client.js';
import { calculatePresentationScore, generateProfessorVerdict } from '../utils/roastGenerator.js';
import TimerControls from '../components/TimerControls.jsx';
import AudioVisualizer from '../components/AudioVisualizer.jsx';
import LiveMetricsBar from '../components/LiveMetricsBar.jsx';
import LiveTranscriptPanel from '../components/LiveTranscriptPanel.jsx';
import SessionSummaryModal from '../components/SessionSummaryModal.jsx';

export default function PracticePage() {
  const navigate = useNavigate();
  const { lang, t } = useTranslation();
  const [speechLang, setSpeechLang] = useState(() => (lang === 'uk' ? 'uk-UA' : 'en-US'));

  useEffect(() => {
    setSpeechLang(lang === 'uk' ? 'uk-UA' : 'en-US');
  }, [lang]);

  const timer = useTimer(180);
  const analytics = useSpeechAnalytics(timer.isRunning, timer.elapsedSec, speechLang);

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const handleFinishSession = useCallback(() => {
    if (timer.isRunning) {
      timer.pause();
    }
    const timingStatus =
      timer.elapsedSec > timer.targetDurationSec ? 'overtime' : 'on_time';
    const score = calculatePresentationScore({
      targetDurationSec: timer.targetDurationSec,
      actualDurationSec: timer.elapsedSec,
      wpm: analytics.wpm,
      pauseCount: analytics.pauseCount,
      totalPauseSec: analytics.totalPauseSec,
      wordCount: analytics.wordCount,
      fillerCount: analytics.fillerCount,
    });
    const verdict = generateProfessorVerdict({
      score,
      wpm: analytics.wpm,
      pauseCount: analytics.pauseCount,
      fillerBreakdown: analytics.fillerBreakdown,
      timingStatus,
      lang,
    });

    setSummaryData({
      targetDurationSec: timer.targetDurationSec,
      actualDurationSec: timer.elapsedSec,
      wordCount: analytics.wordCount,
      wpm: analytics.wpm,
      pauseCount: analytics.pauseCount,
      totalPauseSec: analytics.totalPauseSec,
      estimationMethod: analytics.estimationMethod,
      fillerCount: analytics.fillerCount,
      fillerBreakdown: analytics.fillerBreakdown,
      pacingTimeline: analytics.pacingTimeline,
      transcript: analytics.transcript,
      score,
      verdict,
      defaultTitle: t('summary.defaultTitle'),
    });
    setSaveError(null);
    setSummaryOpen(true);
  }, [
    analytics.estimationMethod,
    analytics.fillerBreakdown,
    analytics.fillerCount,
    analytics.pacingTimeline,
    analytics.pauseCount,
    analytics.totalPauseSec,
    analytics.transcript,
    analytics.wordCount,
    analytics.wpm,
    lang,
    t,
    timer,
  ]);

  const handleResetAll = useCallback(() => {
    timer.reset();
    analytics.resetAnalytics();
  }, [analytics.resetAnalytics, timer.reset]);

  const handleCloseSummary = useCallback(() => {
    setSummaryOpen(false);
  }, []);

  const handleSaveSession = useCallback(
    async ({ title }) => {
      setIsSaving(true);
      setSaveError(null);
      try {
        await presentationsApi.create({
          title,
          target_duration_sec: summaryData.targetDurationSec,
          actual_duration_sec: summaryData.actualDurationSec,
          word_count: summaryData.wordCount,
          wpm: summaryData.wpm,
          pause_count: summaryData.pauseCount,
          total_pause_sec: Number(summaryData.totalPauseSec.toFixed(1)),
          estimation_method: summaryData.estimationMethod,
          score: summaryData.score,
          filler_count: summaryData.fillerCount,
          top_fillers_json: JSON.stringify(summaryData.fillerBreakdown),
          pacing_timeline_json: JSON.stringify(summaryData.pacingTimeline),
          verdict: summaryData.verdict,
        });
        setSummaryOpen(false);
        handleResetAll();
        navigate('/dashboard');
      } catch (err) {
        setSaveError(formatApiError(err, t));
      } finally {
        setIsSaving(false);
      }
    },
    [handleResetAll, navigate, summaryData, t]
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 text-[#F4F5F7]">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#F4F5F7]">
            {t('practice.title')}
          </h1>
          <p className="text-sm text-[#9CA3AF] mt-1">
            {t('practice.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => analytics.setIsSimulatedMic((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              analytics.isSimulatedMic
                ? 'bg-[#FF6363]/15 border-[#FF6363]/60 text-[#FF6363]'
                : 'obsidian-inset text-[#9CA3AF] hover:text-[#F4F5F7]'
            }`}
          >
            {analytics.isSimulatedMic ? t('practice.simMicOn') : t('practice.simMicOff')}
          </button>

          {analytics.isSimulatedMic && (
            <button
              type="button"
              onClick={() => analytics.setIsSimulatingSilence((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                analytics.isSimulatingSilence
                  ? 'bg-[#F59E0B]/15 border-[#F59E0B] text-[#F59E0B]'
                  : 'obsidian-inset text-[#9CA3AF] hover:text-[#F4F5F7]'
              }`}
            >
              {analytics.isSimulatingSilence ? t('practice.simSilenceOn') : t('practice.simSilenceOff')}
            </button>
          )}
        </div>
      </div>

      {/* Rust/WASM Local Speech Engine Status & Progress Bar */}
      <div className="obsidian-glass rounded-xl px-4 py-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-[#C4B5FD] font-medium">
            <Cpu className="h-3.5 w-3.5 text-[#8B5CF6]" />
            <span>{t('practice.wasmEngineLabel')}</span>
          </div>
          <span className="font-mono text-[11px] text-[#10B981]">
            {timer.isRunning ? t('practice.wasmActive') : t('practice.wasmReady')}
          </span>
        </div>
        <div
          data-testid="wasm-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={analytics.modelProgress.percent}
          className="h-1.5 w-full rounded-full obsidian-inset overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] via-[#FF6363] to-[#10B981] transition-all duration-500"
            style={{ width: `${analytics.modelProgress.percent}%` }}
          />
        </div>
      </div>

      {analytics.engineError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-[#FF6363]/12 border border-[#FF6363]/50 px-4 py-3 text-xs font-medium text-[#FCA5A5]"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-[#FF6363]" />
          <span>{analytics.engineError}</span>
        </div>
      )}

      {analytics.micError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-[#FF6363]/12 border border-[#FF6363]/50 px-4 py-3 text-xs font-medium text-[#FCA5A5]"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-[#FF6363]" />
          <span>{analytics.micError}</span>
        </div>
      )}

      <TimerControls
        targetDurationSec={timer.targetDurationSec}
        elapsedSec={timer.elapsedSec}
        remainingSec={timer.remainingSec}
        progressPct={timer.progressPct}
        timerStatus={timer.timerStatus}
        isRunning={timer.isRunning}
        isPaused={timer.isPaused}
        onStart={timer.start}
        onPause={timer.pause}
        onResume={timer.resume}
        onReset={handleResetAll}
        onFinish={handleFinishSession}
        onSetTargetDuration={timer.setTargetDurationSec}
      />

      <AudioVisualizer
        frequencyBars={analytics.frequencyBars}
        rmsRef={analytics.liveRmsRef}
        barsRef={analytics.liveBarsRef}
        isSilentPause={analytics.isSilentPause}
        isRunning={timer.isRunning}
        noiseThreshold={analytics.noiseThreshold}
        onChangeThreshold={analytics.setNoiseThreshold}
        speechLang={speechLang}
        onChangeSpeechLang={setSpeechLang}
      />

      <LiveMetricsBar
        wpm={analytics.wpm}
        rollingWpm={analytics.rollingWpm}
        pacingZone={analytics.pacingZone}
        wordCount={analytics.wordCount}
        pauseCount={analytics.pauseCount}
        totalPauseSec={analytics.totalPauseSec}
        fillerCount={analytics.fillerCount}
        isSilentPause={analytics.isSilentPause}
        currentSilenceSec={analytics.currentSilenceSec}
        estimationMethod={analytics.estimationMethod}
      />

      <LiveTranscriptPanel
        title={t('practice.liveTranscript')}
        transcript={analytics.liveTranscript}
      />

      <SessionSummaryModal
        isOpen={summaryOpen}
        onClose={handleCloseSummary}
        onSave={handleSaveSession}
        summary={summaryData}
        isSaving={isSaving}
        saveError={saveError}
      />
    </div>
  );
}
