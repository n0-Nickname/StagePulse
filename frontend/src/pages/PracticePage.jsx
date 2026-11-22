import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimer } from '../hooks/useTimer.js';
import { useSpeechAnalytics } from '../hooks/useSpeechAnalytics.js';
import { useTranslation } from '../context/LanguageContext.jsx';
import { presentationsApi } from '../api/client.js';
import { calculatePresentationScore, generateProfessorVerdict } from '../utils/roastGenerator.js';
import TimerControls from '../components/TimerControls.jsx';
import AudioVisualizer from '../components/AudioVisualizer.jsx';
import LiveMetricsBar from '../components/LiveMetricsBar.jsx';
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

  const handleFinishSession = () => {
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
  };

  const handleResetAll = () => {
    timer.reset();
    analytics.resetAnalytics();
  };

  const handleSaveSession = async ({ title, notes }) => {
    if (!summaryData) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await presentationsApi.create({
        title,
        notes,
        target_duration_sec: summaryData.targetDurationSec,
        actual_duration_sec: summaryData.actualDurationSec,
        word_count: summaryData.wordCount,
        wpm: summaryData.wpm,
        pause_count: summaryData.pauseCount,
        total_pause_sec: Math.round(summaryData.totalPauseSec),
        score: summaryData.score,
        filler_count: summaryData.fillerCount,
        top_fillers_json: JSON.stringify(summaryData.fillerBreakdown || {}),
        pacing_timeline_json: JSON.stringify(summaryData.pacingTimeline || []),
        verdict: summaryData.verdict,
      });
      setSummaryOpen(false);
      handleResetAll();
      navigate('/dashboard');
    } catch (err) {
      setSaveError(err?.message || t('practice.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 font-['Inter',sans-serif] text-[#EAE6DF]">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-4 border-b border-[#3A3834]">
        <div>
          <h1 className="text-3xl font-medium text-[#EAE6DF] tracking-tight font-['Lora','Newsreader',serif]">
            {t('practice.title')}
          </h1>
          <p className="text-sm text-[#9E9A92] mt-1">
            {t('practice.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => analytics.setIsSimulatedMic((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              analytics.isSimulatedMic
                ? 'bg-[#D97757]/15 border-[#D97757]/60 text-[#D97757]'
                : 'bg-[#2A2926] border-[#3A3834] text-[#9E9A92] hover:text-[#EAE6DF]'
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
                  ? 'bg-[#D49A42]/15 border-[#D49A42] text-[#D49A42]'
                  : 'bg-[#2A2926] border-[#3A3834] text-[#9E9A92] hover:text-[#EAE6DF]'
              }`}
            >
              {analytics.isSimulatingSilence ? t('practice.simSilenceOn') : t('practice.simSilenceOff')}
            </button>
          )}
        </div>
      </div>

      {analytics.micError && (
        <div className="rounded-lg bg-[#D97757]/15 border border-[#D97757]/50 px-4 py-3 text-sm text-[#F2A68D]">
          {analytics.micError}
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
        rmsLevel={analytics.rmsLevel}
        isSilentPause={analytics.isSilentPause}
        isRunning={timer.isRunning}
        noiseThreshold={analytics.noiseThreshold}
        onChangeThreshold={analytics.setNoiseThreshold}
        speechLang={speechLang}
        onChangeSpeechLang={setSpeechLang}
      />

      <LiveMetricsBar
        wpm={analytics.wpm}
        pacingZone={analytics.pacingZone}
        wordCount={analytics.wordCount}
        pauseCount={analytics.pauseCount}
        totalPauseSec={analytics.totalPauseSec}
        isSilentPause={analytics.isSilentPause}
        currentSilenceSec={analytics.currentSilenceSec}
        estimationMethod={analytics.estimationMethod}
      />

      {analytics.liveTranscript && (
        <div className="rounded-xl bg-[#2A2926] border border-[#3A3834] p-4">
          <div className="text-xs font-medium text-[#9E9A92] mb-1.5">
            {t('practice.liveTranscript')}
          </div>
          <p className="text-sm text-[#EAE6DF] leading-relaxed">
            {analytics.liveTranscript}
          </p>
        </div>
      )}

      <SessionSummaryModal
        isOpen={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        onSave={handleSaveSession}
        summary={summaryData}
        isSaving={isSaving}
        saveError={saveError}
      />
    </div>
  );
}
