import React, { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cpu, AlertCircle, Lock, Plus, Sparkles, Tag, X } from 'lucide-react';
import { useTimer } from '../hooks/useTimer.js';
import { useSpeechAnalytics } from '../hooks/useSpeechAnalytics.js';
import { useTranslation } from '../context/LanguageContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  presentationsApi,
  getFillerDictionary,
  updateFillerDictionary,
  formatApiError,
} from '../api/client.js';
import { calculatePresentationScore, generateProfessorVerdict } from '../utils/roastGenerator.js';
import {
  speechStore,
  useSessionStatus,
  normalizeFillerWords,
} from '../stores/speechStore.js';
import TimerControls from '../components/TimerControls.jsx';
import AudioVisualizer from '../components/AudioVisualizer.jsx';
import LiveMetricsBar from '../components/LiveMetricsBar.jsx';
import LiveTranscriptPanel from '../components/LiveTranscriptPanel.jsx';

const SessionSummaryModal = lazy(() => import('../components/SessionSummaryModal.jsx'));

export default function PracticePage() {
  const navigate = useNavigate();
  const { lang, t } = useTranslation();
  const { user, openSlotModal } = useAuth();
  const isPro = Boolean(user?.is_pro);
  const [speechLang, setSpeechLang] = useState(() => (lang === 'uk' ? 'uk-UA' : 'en-US'));
  const [userFillerWords, setUserFillerWords] = useState([]);
  const [fillerInput, setFillerInput] = useState('');
  const [dictError, setDictError] = useState(null);
  const [isSyncingDict, setIsSyncingDict] = useState(false);

  useEffect(() => {
    setSpeechLang(lang === 'uk' ? 'uk-UA' : 'en-US');
  }, [lang]);

  useEffect(() => {
    if (!isPro) {
      setUserFillerWords([]);
      setDictError(null);
      return undefined;
    }
    let cancelled = false;
    getFillerDictionary()
      .then((res) => {
        if (cancelled) return;
        const rawWords = Array.isArray(res) ? res : res?.words;
        setUserFillerWords(normalizeFillerWords(rawWords));
        setDictError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDictError(formatApiError(err, t));
      });
    return () => {
      cancelled = true;
    };
  }, [isPro, t]);

  useEffect(() => {
    return () => {
      speechStore.reset();
    };
  }, []);

  const timer = useTimer(180);
  const analytics = useSpeechAnalytics(timer.isRunning, timer.elapsedSec, speechLang, {
    store: speechStore,
    reactive: false,
    isPro,
    userFillerWords,
  });
  const sessionStatus = useSessionStatus(speechStore);

  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const handleFinishSession = useCallback(() => {
    if (timer.isRunning) {
      timer.pause();
    }
    const actualDurationSec = timer.getElapsedSec();
    const snap = speechStore.getState();
    const timingStatus =
      actualDurationSec > timer.targetDurationSec ? 'overtime' : 'on_time';
    const score = calculatePresentationScore({
      targetDurationSec: timer.targetDurationSec,
      actualDurationSec,
      wpm: snap.wpm,
      pauseCount: snap.longPausesCount,
      totalPauseSec: snap.totalPauseSec,
      wordCount: snap.wordCount,
      fillerCount: snap.fillerCount,
    });
    const verdict = generateProfessorVerdict({
      score,
      wpm: snap.wpm,
      pauseCount: snap.longPausesCount,
      fillerBreakdown: snap.fillerBreakdown,
      timingStatus,
      lang,
    });

    setSummaryData({
      targetDurationSec: timer.targetDurationSec,
      actualDurationSec,
      wordCount: snap.wordCount,
      wpm: snap.wpm,
      pauseCount: snap.longPausesCount,
      totalPauseSec: snap.totalPauseSec,
      estimationMethod: snap.estimationMethod,
      fillerCount: snap.fillerCount,
      fillerBreakdown: snap.fillerBreakdown,
      userFillerWords: snap.userFillerWords,
      pacingTimeline: snap.pacingTimeline,
      transcript: snap.fullText,
      score,
      verdict,
      defaultTitle: t('summary.defaultTitle'),
    });
    setSaveError(null);
    setSummaryOpen(true);
  }, [lang, t, timer]);

  const handleResetAll = useCallback(() => {
    timer.reset();
    analytics.resetAnalytics();
  }, [analytics.resetAnalytics, timer.reset]);

  const handleCloseSummary = useCallback(() => {
    setSummaryOpen(false);
  }, []);

  const syncFillerWords = useCallback(
    async (nextWords, prevWords) => {
      setUserFillerWords(nextWords);
      setDictError(null);
      setIsSyncingDict(true);
      try {
        await updateFillerDictionary(nextWords);
      } catch (err) {
        setUserFillerWords(prevWords);
        setDictError(formatApiError(err, t));
      } finally {
        setIsSyncingDict(false);
      }
    },
    [t]
  );

  const handleAddFillerWord = useCallback(
    async (e) => {
      e.preventDefault();
      const [normalized] = normalizeFillerWords([fillerInput]);
      setFillerInput('');
      if (!normalized || userFillerWords.includes(normalized)) {
        return;
      }
      await syncFillerWords([...userFillerWords, normalized], userFillerWords);
    },
    [fillerInput, syncFillerWords, userFillerWords]
  );

  const handleRemoveFillerWord = useCallback(
    async (wordToRemove) => {
      const nextWords = userFillerWords.filter((w) => w !== wordToRemove);
      await syncFillerWords(nextWords, userFillerWords);
    },
    [syncFillerWords, userFillerWords]
  );

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
    <div className="w-full max-w-5xl mx-auto overflow-x-hidden px-3 sm:px-4 py-5 sm:py-8 pb-28 sm:pb-8 space-y-5 sm:space-y-6 text-[#F4F5F7]">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F4F5F7]">
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
            className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
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
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-[#C4B5FD] font-medium">
            <Cpu className="h-3.5 w-3.5 text-[#8B5CF6]" />
            <span>{t('practice.wasmEngineLabel')}</span>
            <span
              data-testid="wasm-mode-pill"
              className="px-2 py-0.5 rounded-md bg-[#8B5CF6]/15 border border-[#8B5CF6]/35 text-[10px] font-mono text-[#C4B5FD] tabular-nums"
            >
              {sessionStatus.wasmMode} · {sessionStatus.activeLang}
            </span>
          </div>
          <span className="font-mono text-[11px] text-[#10B981] tabular-nums">
            {timer.isRunning ? t('practice.wasmActive') : t('practice.wasmReady')}
          </span>
        </div>
        <div
          data-testid="wasm-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sessionStatus.modelProgress.percent}
          className="h-1.5 w-full rounded-full obsidian-inset overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] via-[#FF6363] to-[#10B981] transition-all duration-500"
            style={{ width: `${sessionStatus.modelProgress.percent}%` }}
          />
        </div>
      </div>

      {sessionStatus.engineError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-[#FF6363]/12 border border-[#FF6363]/50 px-4 py-3 text-xs font-medium text-[#FCA5A5]"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-[#FF6363]" />
          <span>{sessionStatus.engineError}</span>
        </div>
      )}

      {sessionStatus.micError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl bg-[#FF6363]/12 border border-[#FF6363]/50 px-4 py-3 text-xs font-medium text-[#FCA5A5]"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-[#FF6363]" />
          <span>{sessionStatus.micError}</span>
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
        remainingDisplayRef={timer.remainingDisplayRef}
        elapsedDisplayRef={timer.elapsedDisplayRef}
        progressBarRef={timer.progressBarRef}
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
        isRunning={timer.isRunning}
        noiseThreshold={analytics.noiseThreshold}
        onChangeThreshold={analytics.setNoiseThreshold}
        speechLang={speechLang}
        onChangeSpeechLang={setSpeechLang}
        store={speechStore}
      />

      <LiveMetricsBar store={speechStore} onUnlockClick={openSlotModal} />

      {/* PRO — Custom Filler Dictionary Manager */}
      <section className="obsidian-glass rounded-2xl p-3 sm:p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-[#8B5CF6]" />
            <h2 className="text-sm font-semibold text-[#F4F5F7]">
              {t('practice.fillerDictTitle')}
            </h2>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#FDE68A]">
              {t('nav.proBadge')}
            </span>
          </div>
          {isPro && (
            <span className="text-xs text-[#9CA3AF]">{t('practice.fillerDictDesc')}</span>
          )}
        </div>

        {!isPro ? (
          <div
            data-testid="filler-dict-locked"
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl obsidian-inset p-3.5"
          >
            <div className="flex items-center gap-2.5 text-xs text-[#9CA3AF]">
              <Lock className="h-4 w-4 shrink-0 text-[#F59E0B]" />
              <span>{t('practice.fillerDictLockedDesc')}</span>
            </div>
            <button
              type="button"
              onClick={openSlotModal}
              className="crimson-glow-btn inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('practice.upgradePro')}
            </button>
          </div>
        ) : (
          <div data-testid="filler-dict-manager" className="space-y-3">
            <form onSubmit={handleAddFillerWord} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                aria-label={t('practice.fillerDictInputLabel')}
                value={fillerInput}
                onChange={(e) => setFillerInput(e.target.value)}
                placeholder={t('practice.fillerDictPlaceholder')}
                className="flex-1 min-h-[44px] rounded-xl obsidian-inset px-3.5 py-2 text-sm text-[#F4F5F7] placeholder-[#6B7280] focus:outline-none focus:border-[#8B5CF6]"
              />
              <button
                type="submit"
                disabled={isSyncingDict}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#8B5CF6]/20 border border-[#8B5CF6]/45 text-[#C4B5FD] hover:bg-[#8B5CF6]/30 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('practice.fillerDictAdd')}
              </button>
            </form>

            {dictError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl bg-[#FF6363]/12 border border-[#FF6363]/50 px-3.5 py-2 text-xs font-medium text-[#FCA5A5]"
              >
                <AlertCircle className="h-4 w-4 shrink-0 text-[#FF6363]" />
                <span>{dictError}</span>
              </div>
            )}

            {userFillerWords.length === 0 ? (
              <p className="text-xs text-[#9CA3AF]">{t('practice.fillerDictEmpty')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {userFillerWords.map((word) => (
                  <span
                    key={word}
                    className="inline-flex items-center gap-1 pl-3 pr-1 rounded-full text-xs font-medium bg-[#121317] border border-white/[0.1] text-[#F4F5F7]"
                  >
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFillerWord(word)}
                      disabled={isSyncingDict}
                      aria-label={`${t('practice.fillerDictRemove')} ${word}`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-[#9CA3AF] hover:text-[#FF6363] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <LiveTranscriptPanel
        title={t('practice.liveTranscript')}
        store={speechStore}
      />

      {summaryOpen && (
        <Suspense fallback={null}>
          <SessionSummaryModal
            isOpen={summaryOpen}
            onClose={handleCloseSummary}
            onSave={handleSaveSession}
            summary={summaryData}
            isSaving={isSaving}
            saveError={saveError}
          />
        </Suspense>
      )}
    </div>
  );
}
