import { useState, useRef, useEffect, useCallback, useMemo, startTransition } from 'react';
import { startMicCapture } from '../audio/micCapture.js';
import { createDefaultAsrEngine } from '../services/asrAdapter.js';
import { createLogger } from '../utils/logger.js';
import {
  createSpeechStore,
  useSpeechSnapshot,
  buildCommittedBlocks,
  computePartialText,
  detectWasmMode,
  normalizeFillerWords,
  buildFillerRegex,
} from '../stores/speechStore.js';

const logger = createLogger('ASR:Analytics');

const DEFAULT_SILENCE_THRESHOLD = 0.018;
const PAUSE_DURATION_THRESHOLD_MS = 1500;
export const MAX_INTER_WORD_PAUSE_MS = 15000;
const LIVE_PAUSE_POLL_MS = 200;
const SPEECH_BURST_DIP_FACTOR = 1.22;
const SPEECH_BURST_PEAK_FACTOR = 1.95;
const SYLLABLE_COOLDOWN_MS = 140;
const BAR_COUNT = 24;
const TRANSCRIPT_THROTTLE_MS = 120;
const ROLLING_WPM_WINDOW_SEC = 15;
const CACHE_NAME = 'tinyasr-models-v1';
const MODEL_CACHE_KEYS = ['/models/en-ru-uk.tzf.gz', '/models/silero_vad.onnx.gz'];
const INITIAL_BARS = Object.freeze(new Array(BAR_COUNT).fill(0.05));

export function normalizeWordTimestamps(words = []) {
  return words.map((w) => ({
    ...w,
    startMs: w.startMs !== undefined ? w.startMs : Math.round((w.start ?? 0) * 1000),
    endMs: w.endMs !== undefined ? w.endMs : Math.round((w.end ?? 0) * 1000),
  }));
}

export function computeCommittedWordPauses(
  words = [],
  thresholdMs = PAUSE_DURATION_THRESHOLD_MS
) {
  if (!Array.isArray(words) || words.length === 0) {
    return { pauseCount: 0, totalPauseMs: 0, gaps: [] };
  }

  const normalized = normalizeWordTimestamps(words);
  let pauseCount = 0;
  let totalPauseMs = 0;
  const gaps = [];

  for (let i = 1; i < normalized.length; i += 1) {
    const prev = normalized[i - 1];
    const curr = normalized[i];
    if (prev.endMs <= 0) continue;
    const gapMs = curr.startMs - prev.endMs;
    if (gapMs >= thresholdMs) {
      pauseCount += 1;
      totalPauseMs += gapMs;
      gaps.push({
        prevWord: prev.text || '',
        nextWord: curr.text || '',
        gapMs,
      });
    }
  }

  return { pauseCount, totalPauseMs, gaps };
}

export function computeActiveSpeakingSec(
  speakingElapsedSec,
  words = [],
  maxPauseMs = MAX_INTER_WORD_PAUSE_MS,
  extraLiveSilenceMs = 0
) {
  let outlierExcessMs = 0;
  if (Array.isArray(words) && words.length > 1) {
    const normalized = normalizeWordTimestamps(words);
    for (let i = 1; i < normalized.length; i += 1) {
      const prev = normalized[i - 1];
      const curr = normalized[i];
      if (prev.endMs <= 0) continue;
      const gapMs = curr.startMs - prev.endMs;
      if (gapMs > maxPauseMs) {
        outlierExcessMs += gapMs - maxPauseMs;
      }
    }
  }
  if (extraLiveSilenceMs > maxPauseMs) {
    outlierExcessMs += extraLiveSilenceMs - maxPauseMs;
  }
  return Math.max(0, speakingElapsedSec - outlierExcessMs / 1000);
}

export function computeWordTimestampPauses(
  words = [],
  currentElapsedMs = 0,
  thresholdMs = PAUSE_DURATION_THRESHOLD_MS
) {
  if (!Array.isArray(words) || words.length === 0) {
    return {
      pauseCount: 0,
      totalPauseSec: 0,
      isSilentPause: false,
      currentSilenceSec: 0,
    };
  }

  const normalized = normalizeWordTimestamps(words);
  const committed = computeCommittedWordPauses(normalized, thresholdMs);
  let pauseCount = committed.pauseCount;
  let totalPauseMs = committed.totalPauseMs;

  const lastWord = normalized[normalized.length - 1];
  const trailingSilenceMs = Math.max(0, currentElapsedMs - lastWord.endMs);
  const isSilentPause = trailingSilenceMs >= thresholdMs;
  const currentSilenceSec = Number((trailingSilenceMs / 1000).toFixed(1));

  if (isSilentPause) {
    pauseCount += 1;
    totalPauseMs += trailingSilenceMs;
  }

  return {
    pauseCount,
    totalPauseSec: Number((totalPauseMs / 1000).toFixed(1)),
    isSilentPause,
    currentSilenceSec,
  };
}

export function countNormalizedWords(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/[\s—–-]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}'’]+|[^\p{L}\p{N}'’]+$/gu, ''))
    .filter(Boolean).length;
}

export function computeOverallWpm(wordCount, elapsedSec) {
  if (elapsedSec < 5 || wordCount <= 0) return 0;
  return Math.round(wordCount / (elapsedSec / 60));
}

export function computeRollingWpm(
  wordSamples = [],
  currentElapsedSec = 0,
  firstSpeechSec = 0,
  windowSec = ROLLING_WPM_WINDOW_SEC
) {
  if (!Array.isArray(wordSamples) || wordSamples.length === 0) return 0;
  const effectiveStart = Math.max(firstSpeechSec, currentElapsedSec - windowSec);
  const durationSec = currentElapsedSec - effectiveStart;
  if (durationSec < 3) return 0;

  const latestWords = wordSamples[wordSamples.length - 1].words;
  let baselineWords = 0;
  if (effectiveStart > firstSpeechSec) {
    for (let i = 0; i < wordSamples.length; i += 1) {
      if (wordSamples[i].t <= effectiveStart) {
        baselineWords = wordSamples[i].words;
      } else {
        break;
      }
    }
  }
  const deltaWords = Math.max(0, latestWords - baselineWords);
  if (deltaWords <= 0) return 0;
  return Math.round(deltaWords / (durationSec / 60));
}

async function verifyModelCache() {
  if (typeof globalThis.caches?.open !== 'function') {
    return { modelCached: false, vadCached: false };
  }
  try {
    const cache = await globalThis.caches.open(CACHE_NAME);
    const [modelHit, vadHit] = await Promise.all(
      MODEL_CACHE_KEYS.map((key) => cache.match(key))
    );
    const result = {
      modelCached: Boolean(modelHit),
      vadCached: Boolean(vadHit),
    };
    logger.info('CacheStorage warmup check', result);
    return result;
  } catch (err) {
    logger.warn('CacheStorage warmup check failed', { err });
    return { modelCached: false, vadCached: false };
  }
}

export function analyzeFillers(text, userFillerWords = [], isPro = false) {
  if (!text || !isPro) {
    return { fillerCount: 0, fillerBreakdown: {} };
  }
  const { regex } = buildFillerRegex(userFillerWords);
  if (!regex) {
    return { fillerCount: 0, fillerBreakdown: {} };
  }

  const counts = {};
  let total = 0;
  let match = regex.exec(text);
  while (match !== null) {
    const key = match[2].toLowerCase().replace(/\s+/g, ' ');
    counts[key] = (counts[key] || 0) + 1;
    total += 1;
    match = regex.exec(text);
  }

  return { fillerCount: total, fillerBreakdown: counts };
}

function derivePacingZone(wpm) {
  if (wpm === 0) return 'warming_up';
  if (wpm < 110) return 'too_slow';
  if (wpm <= 160) return 'optimal';
  return 'too_fast';
}

function buildBarsFromRms(rms) {
  const norm = Math.min(1, rms / 0.15);
  return new Array(BAR_COUNT).fill(0).map((_, idx) => {
    const centerWeight = 1 - Math.abs(idx - BAR_COUNT / 2) / (BAR_COUNT / 2);
    return Math.max(0.05, Math.min(1, norm * centerWeight * 1.15 + 0.05));
  });
}

export function useSpeechAnalytics(
  isRunning,
  activeElapsedSec,
  speechLang = 'uk-UA',
  options = {}
) {
  const {
    engineFactory,
    micCaptureFactory = startMicCapture,
    store: externalStore,
    reactive = true,
    isPro = false,
    userFillerWords = [],
  } = options;

  const fillerWordsKey = Array.isArray(userFillerWords) ? userFillerWords.join('\u0001') : '';
  const normalizedFillerWords = useMemo(
    () => normalizeFillerWords(userFillerWords),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fillerWordsKey]
  );

  const store = useMemo(() => externalStore ?? createSpeechStore(), [externalStore]);
  const noopStore = useMemo(() => createSpeechStore(), []);
  const snapshot = useSpeechSnapshot(reactive ? store : noopStore);

  const isProRef = useRef(Boolean(isPro));
  const userFillerWordsRef = useRef(normalizedFillerWords);

  const [silenceThreshold, setSilenceThreshold] = useState(DEFAULT_SILENCE_THRESHOLD);
  const [isSimulatedMic, setIsSimulatedMic] = useState(false);
  const [isSimulatingSilence, setIsSimulatingSilence] = useState(false);

  const lastTimelineBucketRef = useRef(-1);

  // Zero-rerender audio meter refs driven via rAF in AudioVisualizer
  const liveRmsRef = useRef(0);
  const liveBarsRef = useRef([...INITIAL_BARS]);

  // Active speaking WPM & rolling 15s WPM refs
  const activeElapsedSecRef = useRef(activeElapsedSec);
  const startElapsedRef = useRef(null);
  const firstSpeechSecRef = useRef(null);
  const wordSamplesRef = useRef([]);
  const wordsRef = useRef([]);
  const wordCountRef = useRef(0);
  const liveTranscriptRef = useRef('');
  const livePauseMsRef = useRef(0);
  const committedPausesRef = useRef({ pauseCount: 0, totalPauseMs: 0, gaps: [] });

  // Transcript throttle, live active pause timer & warmup refs
  const transcriptTimerRef = useRef(null);
  const pendingTranscriptRef = useRef(null);
  const lastTranscriptFlushMsRef = useRef(null);
  const lastWordActivityAtRef = useRef(null);
  const lastFullTextWordCountRef = useRef(0);
  const lastFullTextValueRef = useRef('');
  const hasPartialStreamingRef = useRef(false);
  const loggedGapCountRef = useRef(0);
  const warmedEngineRef = useRef(null);
  const liveCallbacksRef = useRef({
    onProgress: null,
    onTranscript: null,
    onError: null,
  });

  // Mutable refs for 60fps loop without stale closures
  const isRunningRef = useRef(isRunning);
  const silenceThresholdRef = useRef(silenceThreshold);
  const isSimulatedMicRef = useRef(isSimulatedMic);
  const isSimulatingSilenceRef = useRef(isSimulatingSilence);
  const estimationMethodRef = useRef('speech_api');
  const speechLangRef = useRef(speechLang);
  const engineFactoryRef = useRef(engineFactory);
  const micCaptureFactoryRef = useRef(micCaptureFactory);

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const rafIdRef = useRef(null);
  const recognitionRef = useRef(null);
  const asrEngineRef = useRef(null);
  const micCaptureHandleRef = useRef(null);

  // Speech & Syllable Burst counters
  const finalizedWordsRef = useRef(0);
  const interimWordsRef = useRef(0);
  const syllableCountRef = useRef(0);
  const burstArmedRef = useRef(true);
  const lastSyllableMsRef = useRef(0);

  const syncDerivedMetricsToStore = useCallback(
    (nextElapsedSec = activeElapsedSecRef.current) => {
      const currentWords = wordsRef.current;
      const currentWordCount = wordCountRef.current;
      const currentLivePauseMs = livePauseMsRef.current;
      const committed = committedPausesRef.current;
      const hasLiveActivePause =
        isRunningRef.current && currentLivePauseMs >= PAUSE_DURATION_THRESHOLD_MS;

      const effectivePauseCount = committed.pauseCount + (hasLiveActivePause ? 1 : 0);
      const effectiveTotalPauseSec = Number(
        ((committed.totalPauseMs + (hasLiveActivePause ? currentLivePauseMs : 0)) / 1000).toFixed(1)
      );
      const effectiveCurrentSilenceSec = hasLiveActivePause
        ? Number((currentLivePauseMs / 1000).toFixed(1))
        : 0;

      if (isRunningRef.current) {
        if (startElapsedRef.current === null) {
          startElapsedRef.current = nextElapsedSec;
        }
        if (currentWordCount > 0) {
          const samples = wordSamplesRef.current;
          const last = samples[samples.length - 1];
          if (last && last.t === nextElapsedSec) {
            last.words = currentWordCount;
          } else {
            samples.push({ t: nextElapsedSec, words: currentWordCount });
          }
        }
      }

      const speakingElapsedSec = Math.max(0, nextElapsedSec - (firstSpeechSecRef.current ?? 0));
      const activeSpeakingSec = computeActiveSpeakingSec(
        speakingElapsedSec,
        currentWords,
        MAX_INTER_WORD_PAUSE_MS,
        hasLiveActivePause ? currentLivePauseMs : 0
      );

      const wpm = computeOverallWpm(currentWordCount, activeSpeakingSec);
      const rollingWpm = computeRollingWpm(
        wordSamplesRef.current,
        nextElapsedSec,
        firstSpeechSecRef.current ?? 0
      );
      const pacingZone = derivePacingZone(wpm);

      const patch = {
        wordCount: currentWordCount,
        wpm,
        rollingWpm,
        pacingZone,
        longPausesCount: effectivePauseCount,
        activePauseMs: currentLivePauseMs,
        isPausedLive: hasLiveActivePause,
        totalPauseSec: effectiveTotalPauseSec,
        currentSilenceSec: effectiveCurrentSilenceSec,
      };

      if (isRunningRef.current && nextElapsedSec > 0) {
        const bucket = Math.floor(nextElapsedSec / 10);
        if (
          bucket > lastTimelineBucketRef.current &&
          nextElapsedSec >= 10 &&
          nextElapsedSec % 10 === 0
        ) {
          lastTimelineBucketRef.current = bucket;
          const prevTimeline = store.getState().pacingTimeline;
          patch.pacingTimeline = [...prevTimeline, { sec: nextElapsedSec, wpm }];
        }
      }

      store.patch(patch);
    },
    [store]
  );

  useEffect(() => {
    activeElapsedSecRef.current = activeElapsedSec;
    syncDerivedMetricsToStore(activeElapsedSec);
  }, [activeElapsedSec, syncDerivedMetricsToStore]);

  useEffect(() => {
    isRunningRef.current = isRunning;
    store.patch({ isRecording: isRunning });
  }, [isRunning, store]);

  useEffect(() => {
    silenceThresholdRef.current = silenceThreshold;
  }, [silenceThreshold]);

  useEffect(() => {
    isSimulatedMicRef.current = isSimulatedMic;
  }, [isSimulatedMic]);

  useEffect(() => {
    isSimulatingSilenceRef.current = isSimulatingSilence;
  }, [isSimulatingSilence]);

  useEffect(() => {
    speechLangRef.current = speechLang;
    store.patch({
      activeLang: speechLang,
      wasmMode: detectWasmMode(),
    });
  }, [speechLang, store]);

  useEffect(() => {
    const nextIsPro = Boolean(isPro);
    isProRef.current = nextIsPro;
    userFillerWordsRef.current = normalizedFillerWords;
    const { fillerCount, fillerBreakdown } = analyzeFillers(
      liveTranscriptRef.current,
      normalizedFillerWords,
      nextIsPro
    );
    store.patch({
      isPro: nextIsPro,
      userFillerWords: normalizedFillerWords,
      fillerCount,
      fillerBreakdown,
    });
  }, [isPro, normalizedFillerWords, store]);

  useEffect(() => {
    engineFactoryRef.current = engineFactory;
  }, [engineFactory]);

  useEffect(() => {
    micCaptureFactoryRef.current = micCaptureFactory;
  }, [micCaptureFactory]);

  const setEstimationMethod = useCallback(
    (method) => {
      estimationMethodRef.current = method;
      store.patch({ estimationMethod: method });
    },
    [store]
  );

  const setWordCount = useCallback(
    (nextCount) => {
      wordCountRef.current = nextCount;
      syncDerivedMetricsToStore(activeElapsedSecRef.current);
    },
    [syncDerivedMetricsToStore]
  );

  const stopAudioAndSpeech = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (transcriptTimerRef.current !== null) {
      clearTimeout(transcriptTimerRef.current);
      transcriptTimerRef.current = null;
    }
    pendingTranscriptRef.current = null;
    if (micCaptureHandleRef.current) {
      try {
        micCaptureHandleRef.current.stop();
      } catch {
        // Ignore stop errors
      }
      micCaptureHandleRef.current = null;
    }
    if (asrEngineRef.current) {
      try {
        asrEngineRef.current.destroy();
      } catch {
        // Ignore destroy errors
      }
      asrEngineRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.abort();
      } catch {
        // Ignore abort errors
      }
      recognitionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore stop errors
        }
      });
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        if (audioCtxRef.current.state !== 'closed') {
          audioCtxRef.current.close();
        }
      } catch {
        // Ignore close errors
      }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    liveRmsRef.current = 0;
    liveBarsRef.current = [...INITIAL_BARS];
    lastTranscriptFlushMsRef.current = null;
    hasPartialStreamingRef.current = false;
    livePauseMsRef.current = 0;
    store.patch({
      activePauseMs: 0,
      isPausedLive: false,
      isSpeaking: false,
      currentSilenceSec: 0,
    });
  }, [store]);

  const pushAudioRms = useCallback((rms, bars) => {
    const normalizedRms = Math.min(1, rms / 0.15);
    liveRmsRef.current = normalizedRms;
    liveBarsRef.current = bars || buildBarsFromRms(rms);
  }, []);

  const markFirstSpeechDetected = useCallback(() => {
    if (firstSpeechSecRef.current === null) {
      const elapsed = activeElapsedSecRef.current;
      const startAt = startElapsedRef.current ?? elapsed;
      firstSpeechSecRef.current = elapsed > startAt ? elapsed : 0;
    }
  }, []);

  const trackWordActivity = useCallback(
    (payload) => {
      const safeWords = Array.isArray(payload?.words) ? payload.words : [];
      const text = payload?.fullText || '';
      const liveWordsCount = Math.max(countNormalizedWords(text), safeWords.length);

      if (!text && safeWords.length === 0) {
        lastWordActivityAtRef.current = null;
        lastFullTextWordCountRef.current = 0;
        lastFullTextValueRef.current = '';
        hasPartialStreamingRef.current = false;
        livePauseMsRef.current = 0;
        store.patch({
          activePauseMs: 0,
          isPausedLive: false,
          isSpeaking: false,
          currentSilenceSec: 0,
        });
        return;
      }

      hasPartialStreamingRef.current = !payload?.isFinal && Boolean(text);

      if (
        liveWordsCount > 0 &&
        (liveWordsCount !== lastFullTextWordCountRef.current || text !== lastFullTextValueRef.current)
      ) {
        lastWordActivityAtRef.current = performance.now();
        lastFullTextWordCountRef.current = liveWordsCount;
        lastFullTextValueRef.current = text;
        livePauseMsRef.current = 0;
        store.patch({
          activePauseMs: 0,
          isPausedLive: false,
          isSpeaking: true,
          currentSilenceSec: 0,
        });
      }
    },
    [store]
  );

  const applyTranscriptPayload = useCallback(
    (payload) => {
      const safeWords = Array.isArray(payload?.words) ? payload.words : [];
      const fullText = payload?.fullText || '';
      const liveWordsCount = Math.max(countNormalizedWords(fullText), safeWords.length);
      if (liveWordsCount > 0) {
        markFirstSpeechDetected();
      }
      wordsRef.current = safeWords;
      wordCountRef.current = liveWordsCount;
      liveTranscriptRef.current = fullText;

      const { committedText, partialText } = computePartialText(safeWords, fullText);
      // Urgent partial tail update for snappy live typing feel
      store.patch({
        partialText,
        fullText,
        wordCount: liveWordsCount,
      });

      // Defer non-urgent block chunking, pause gap scans, filler analysis & WPM recalculation
      startTransition(() => {
        const prevBlocks = store.getState().committedBlocks;
        const committedBlocks = buildCommittedBlocks(safeWords, prevBlocks);
        const committed = computeCommittedWordPauses(safeWords, PAUSE_DURATION_THRESHOLD_MS);
        committedPausesRef.current = committed;

        if (committed.gaps.length > loggedGapCountRef.current) {
          for (let i = loggedGapCountRef.current; i < committed.gaps.length; i += 1) {
            logger.debug('Committed word gap detected', committed.gaps[i]);
          }
          loggedGapCountRef.current = committed.gaps.length;
        }

        const { fillerCount, fillerBreakdown } = analyzeFillers(
          fullText,
          userFillerWordsRef.current,
          isProRef.current
        );

        store.patch({
          committedWords: safeWords,
          committedBlocks,
          committedText,
          fillerCount,
          fillerBreakdown,
        });
        syncDerivedMetricsToStore(activeElapsedSecRef.current);
      });
    },
    [markFirstSpeechDetected, store, syncDerivedMetricsToStore]
  );

  const handleThrottledTranscript = useCallback(
    (payload) => {
      trackWordActivity(payload);
      const safeWords = Array.isArray(payload?.words) ? payload.words : [];
      const text = payload?.fullText || '';
      const isEmptyReset = !text && safeWords.length === 0;
      const now = performance.now();

      if (
        payload?.isFinal ||
        isEmptyReset ||
        lastTranscriptFlushMsRef.current === null ||
        now - lastTranscriptFlushMsRef.current >= TRANSCRIPT_THROTTLE_MS
      ) {
        if (transcriptTimerRef.current !== null) {
          clearTimeout(transcriptTimerRef.current);
          transcriptTimerRef.current = null;
        }
        pendingTranscriptRef.current = null;
        lastTranscriptFlushMsRef.current = now;
        applyTranscriptPayload(payload || {});
        return;
      }

      pendingTranscriptRef.current = payload;
      if (transcriptTimerRef.current === null) {
        const waitMs = Math.max(
          0,
          TRANSCRIPT_THROTTLE_MS - (now - lastTranscriptFlushMsRef.current)
        );
        transcriptTimerRef.current = setTimeout(() => {
          transcriptTimerRef.current = null;
          lastTranscriptFlushMsRef.current = performance.now();
          const latest = pendingTranscriptRef.current;
          pendingTranscriptRef.current = null;
          if (latest) {
            applyTranscriptPayload(latest);
          }
        }, waitMs);
      }
    },
    [applyTranscriptPayload, trackWordActivity]
  );

  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognitionCtor =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!SpeechRecognitionCtor || isSimulatedMicRef.current) {
      setEstimationMethod('audio_burst');
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = speechLangRef.current || 'uk-UA';

      recognition.onresult = (event) => {
        let newFinalWords = 0;
        let currentInterimWords = 0;
        let recentText = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const transcript = event.results[i][0].transcript.trim();
          if (!transcript) continue;
          const count = countNormalizedWords(transcript);
          if (event.results[i].isFinal) {
            newFinalWords += count;
          } else {
            currentInterimWords += count;
          }
          recentText = transcript;
        }

        if (newFinalWords > 0) {
          finalizedWordsRef.current += newFinalWords;
        }
        interimWordsRef.current = currentInterimWords;

        const speechTotal = finalizedWordsRef.current + interimWordsRef.current;
        const syllableRatio = speechLangRef.current.startsWith('uk') ? 1.8 : 1.5;
        const burstEstimated = Math.round(syllableCountRef.current / syllableRatio);
        const nextTotal = Math.max(speechTotal, burstEstimated);
        if (nextTotal > 0) {
          markFirstSpeechDetected();
          lastWordActivityAtRef.current = performance.now();
          livePauseMsRef.current = 0;
          store.patch({
            activePauseMs: 0,
            isPausedLive: false,
            isSpeaking: true,
            currentSilenceSec: 0,
          });
        }
        wordCountRef.current = nextTotal;
        if (recentText) {
          const clipped = recentText.slice(-90);
          liveTranscriptRef.current = clipped;
          const { fillerCount, fillerBreakdown } = analyzeFillers(
            clipped,
            userFillerWordsRef.current,
            isProRef.current
          );
          store.patch({
            partialText: clipped,
            fullText: clipped,
            fillerCount,
            fillerBreakdown,
          });
        }
        syncDerivedMetricsToStore(activeElapsedSecRef.current);
      };

      recognition.onerror = (event) => {
        if (event.error) {
          setEstimationMethod('audio_burst');
        }
      };

      recognition.onend = () => {
        if (
          isRunningRef.current &&
          estimationMethodRef.current === 'speech_api' &&
          !isSimulatedMicRef.current
        ) {
          try {
            recognition.start();
          } catch {
            setEstimationMethod('audio_burst');
          }
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setEstimationMethod('audio_burst');
    }
  }, [markFirstSpeechDetected, setEstimationMethod, store, syncDerivedMetricsToStore]);

  const startAnalysisLoop = useCallback(() => {
    const timeDomainBuffer = analyserRef.current
      ? new Float32Array(analyserRef.current.fftSize)
      : null;
    const freqBuffer = analyserRef.current
      ? new Uint8Array(analyserRef.current.frequencyBinCount)
      : null;

    let uiThrottleMs = 0;
    let calibrationStartMs = null;
    let calibrationSumRms = 0;
    let calibrationSamples = 0;
    let isCalibrated = false;

    const tick = (now) => {
      if (!isRunningRef.current) return;

      let rms = 0;
      let bars = null;

      if (isSimulatedMicRef.current || !analyserRef.current) {
        if (isSimulatingSilenceRef.current) {
          rms = 0.004 + Math.random() * 0.003;
          bars = new Array(BAR_COUNT).fill(0).map(() => 0.04 + Math.random() * 0.03);
        } else {
          const cycle = (now % 4200) / 4200;
          const isMicroBreathing = cycle > 0.86;
          if (isMicroBreathing) {
            rms = 0.011;
          } else {
            const syllableWave = Math.sin(now * 0.022) * 0.5 + 0.5;
            rms = 0.02 + syllableWave * 0.09 + Math.random() * 0.015;
          }
          bars = new Array(BAR_COUNT).fill(0).map((_, idx) => {
            const centerWeight = 1 - Math.abs(idx - BAR_COUNT / 2) / (BAR_COUNT / 2);
            return Math.min(1, Math.max(0.06, rms * 6.5 * centerWeight + Math.random() * 0.12));
          });
        }
      } else {
        analyserRef.current.getFloatTimeDomainData(timeDomainBuffer);
        let sumSquares = 0;
        for (let i = 0; i < timeDomainBuffer.length; i += 1) {
          const sample = timeDomainBuffer[i];
          sumSquares += sample * sample;
        }
        rms = Math.sqrt(sumSquares / timeDomainBuffer.length);

        analyserRef.current.getByteFrequencyData(freqBuffer);
        const step = Math.max(1, Math.floor(freqBuffer.length / BAR_COUNT));
        bars = new Array(BAR_COUNT).fill(0).map((_, idx) => {
          const val = freqBuffer[Math.min(freqBuffer.length - 1, idx * step)] / 255;
          return Math.max(0.05, Math.min(1, val));
        });
      }

      if (!isCalibrated && !isSimulatedMicRef.current) {
        if (calibrationStartMs === null) {
          calibrationStartMs = now;
        }
        calibrationSumRms += rms;
        calibrationSamples += 1;
        if (now - calibrationStartMs >= 1000 && calibrationSamples > 0) {
          const ambientRms = calibrationSumRms / calibrationSamples;
          const dynamicThreshold = Math.max(0.045, Number((ambientRms * 2.2).toFixed(3)));
          silenceThresholdRef.current = dynamicThreshold;
          setSilenceThreshold(dynamicThreshold);
          isCalibrated = true;
        }
      }

      const threshold = silenceThresholdRef.current;

      // Syllable Energy Burst Detector (visual meter + fallback word estimate; no RMS pause state machine)
      const dipThreshold = threshold * SPEECH_BURST_DIP_FACTOR;
      const peakThreshold = Math.max(0.032, threshold * SPEECH_BURST_PEAK_FACTOR);

      if (rms < dipThreshold) {
        burstArmedRef.current = true;
      } else if (
        burstArmedRef.current &&
        rms >= peakThreshold &&
        now - lastSyllableMsRef.current >= SYLLABLE_COOLDOWN_MS
      ) {
        burstArmedRef.current = false;
        lastSyllableMsRef.current = now;
        syllableCountRef.current += 1;

        const burstWords = Math.round(syllableCountRef.current / 1.5);
        if (burstWords > 0) {
          markFirstSpeechDetected();
        }
        if (estimationMethodRef.current === 'audio_burst') {
          setWordCount(burstWords);
        } else {
          const speechWords = finalizedWordsRef.current + interimWordsRef.current;
          if (burstWords > speechWords) {
            setWordCount(burstWords);
          }
        }
      }

      if (now - uiThrottleMs >= 50) {
        uiThrottleMs = now;
        pushAudioRms(rms, bars);
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, [markFirstSpeechDetected, pushAudioRms, setWordCount]);

  // Pre-warm WASM runtime & verify CacheStorage on mount when idle
  useEffect(() => {
    const useWasmPipeline =
      Boolean(engineFactoryRef.current) || typeof globalThis.Worker !== 'undefined';
    if (!useWasmPipeline || isSimulatedMic || isRunning || warmedEngineRef.current) {
      return undefined;
    }

    let cancelled = false;
    const activeLang = speechLang.startsWith('uk') ? 'uk' : 'en';
    verifyModelCache();

    const adapter = engineFactoryRef.current
      ? engineFactoryRef.current()
      : createDefaultAsrEngine();
    store.patch({
      modelProgress: { percent: 0, cached: false, ready: false },
      isWarmingUp: true,
      wasmMode: detectWasmMode(),
    });

    const initPromise = adapter
      .init({
        lang: activeLang,
        onProgress: ({ percent, cached }) => {
          if (liveCallbacksRef.current.onProgress) {
            liveCallbacksRef.current.onProgress({ percent, cached });
          } else if (!cancelled) {
            const ready = percent >= 100;
            store.patch({
              modelProgress: { percent, cached, ready },
              isWarmingUp: !ready,
            });
          }
        },
        onTranscript: (payload) => {
          liveCallbacksRef.current.onTranscript?.(payload);
        },
        onError: (err) => {
          if (liveCallbacksRef.current.onError) {
            liveCallbacksRef.current.onError(err);
          } else {
            logger.error('WASM ASR warmup error', { err });
            if (!cancelled) {
              store.patch({
                engineError: err?.message || 'ASR engine error',
                modelProgress: { percent: 0, cached: false, ready: false },
                isWarmingUp: false,
              });
            }
          }
        },
      })
      .then(() => {
        if (!cancelled && !liveCallbacksRef.current.onProgress) {
          const prev = store.getState().modelProgress;
          store.patch({
            modelProgress: { ...prev, percent: 100, ready: true },
            isWarmingUp: false,
          });
        }
      });

    initPromise.catch(() => {});
    warmedEngineRef.current = { adapter, lang: activeLang, initPromise };

    return () => {
      cancelled = true;
    };
  }, [isRunning, isSimulatedMic, speechLang, store]);

  useEffect(() => {
    return () => {
      if (warmedEngineRef.current) {
        try {
          warmedEngineRef.current.adapter.destroy();
        } catch {
          // Ignore destroy errors
        }
        warmedEngineRef.current = null;
      }
    };
  }, []);

  // Manage lifecycle when `isRunning` changes
  useEffect(() => {
    let cancelled = false;

    async function initLegacyMicPipeline() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser mediaDevices API unavailable');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (cancelled || !isRunningRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      mediaStreamRef.current = stream;
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextCtor();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;

      startSpeechRecognition();
      startAnalysisLoop();
    }

    async function initAudioAndSpeech() {
      if (!isRunning) {
        stopAudioAndSpeech();
        return;
      }

      if (isSimulatedMicRef.current) {
        setEstimationMethod('audio_burst');
        startAnalysisLoop();
        return;
      }

      store.patch({ micError: null, engineError: null });

      const useWasmPipeline =
        Boolean(engineFactoryRef.current) || typeof globalThis.Worker !== 'undefined';

      if (useWasmPipeline) {
        const activeLang = speechLangRef.current.startsWith('uk') ? 'uk' : 'en';
        const warmed = warmedEngineRef.current;
        const canReuseWarmed = Boolean(warmed && warmed.lang === activeLang);
        if (warmed && !canReuseWarmed) {
          warmed.adapter.destroy();
          warmedEngineRef.current = null;
        }

        const adapter = canReuseWarmed
          ? warmed.adapter
          : engineFactoryRef.current
            ? engineFactoryRef.current()
            : createDefaultAsrEngine();
        if (canReuseWarmed) {
          warmedEngineRef.current = null;
        }

        asrEngineRef.current = adapter;
        if (!canReuseWarmed) {
          store.patch({
            modelProgress: { percent: 0, cached: false, ready: false },
            isWarmingUp: true,
          });
        }

        const onProgressCb = ({ percent, cached }) => {
          if (!cancelled) {
            const ready = percent >= 100;
            store.patch({
              modelProgress: { percent, cached, ready },
              isWarmingUp: !ready,
            });
          }
        };
        const onTranscriptCb = (payload) => {
          if (cancelled) return;
          handleThrottledTranscript(payload);
        };
        const onErrorCb = (err) => {
          logger.error('WASM ASR engine error', { err });
          if (!cancelled) {
            store.patch({
              engineError: err?.message || 'ASR engine error',
              isWarmingUp: false,
            });
          }
        };
        liveCallbacksRef.current = {
          onProgress: onProgressCb,
          onTranscript: onTranscriptCb,
          onError: onErrorCb,
        };

        try {
          if (canReuseWarmed) {
            await warmed.initPromise;
          } else {
            await adapter.init({
              lang: activeLang,
              onProgress: onProgressCb,
              onTranscript: onTranscriptCb,
              onError: onErrorCb,
            });
          }

          if (cancelled || !isRunningRef.current) {
            adapter.destroy();
            asrEngineRef.current = null;
            return;
          }

          const prevProg = store.getState().modelProgress;
          store.patch({
            modelProgress: { ...prevProg, percent: 100, ready: true },
            isWarmingUp: false,
          });
          setEstimationMethod('speech_api');

          const capture = await micCaptureFactoryRef.current({
            onChunk: (chunk) => adapter.pushAudio(chunk),
            onRms: (rms) => pushAudioRms(rms),
          });

          if (cancelled || !isRunningRef.current) {
            capture.stop();
            adapter.destroy();
            return;
          }

          micCaptureHandleRef.current = capture;
          return;
        } catch (err) {
          adapter.destroy();
          asrEngineRef.current = null;
          if (err?.message && /mediaDevices|Permission|Audio/i.test(err.message)) {
            logger.error('Mic capture error in WASM pipeline', { err });
            if (!cancelled) {
              store.patch({ micError: err.message });
              setIsSimulatedMic(true);
              isSimulatedMicRef.current = true;
              setEstimationMethod('audio_burst');
              startAnalysisLoop();
            }
            return;
          }
          logger.error('WASM ASR pipeline failed, falling back to legacy speech/burst', { err });
          if (!cancelled) {
            store.patch({
              engineError: err?.message || 'ASR engine initialization failed',
              modelProgress: { percent: 0, cached: false, ready: false },
              isWarmingUp: false,
            });
          }
        }
      }

      try {
        await initLegacyMicPipeline();
      } catch (err) {
        if (cancelled) return;
        store.patch({
          micError:
            err?.message || 'Microphone unavailable — switched to Demo Speech Simulator',
        });
        setIsSimulatedMic(true);
        isSimulatedMicRef.current = true;
        setEstimationMethod('audio_burst');
        startAnalysisLoop();
      }
    }

    initAudioAndSpeech();

    return () => {
      cancelled = true;
      liveCallbacksRef.current = { onProgress: null, onTranscript: null, onError: null };
      stopAudioAndSpeech();
    };
  }, [
    isRunning,
    isSimulatedMic,
    handleThrottledTranscript,
    pushAudioRms,
    setEstimationMethod,
    startAnalysisLoop,
    startSpeechRecognition,
    stopAudioAndSpeech,
    store,
  ]);

  // Live active pause timer while recording after >= 1 spoken word
  useEffect(() => {
    if (!isRunning) {
      livePauseMsRef.current = 0;
      syncDerivedMetricsToStore(activeElapsedSecRef.current);
      return undefined;
    }
    const intervalId = setInterval(() => {
      if (lastWordActivityAtRef.current === null || hasPartialStreamingRef.current) {
        livePauseMsRef.current = 0;
        syncDerivedMetricsToStore(activeElapsedSecRef.current);
        return;
      }
      const elapsedSinceLastWord = performance.now() - lastWordActivityAtRef.current;
      if (elapsedSinceLastWord >= PAUSE_DURATION_THRESHOLD_MS) {
        livePauseMsRef.current = elapsedSinceLastWord;
        store.patch({ isSpeaking: false });
      } else {
        livePauseMsRef.current = 0;
        store.patch({ isSpeaking: true });
      }
      syncDerivedMetricsToStore(activeElapsedSecRef.current);
    }, LIVE_PAUSE_POLL_MS);

    return () => clearInterval(intervalId);
  }, [isRunning, store, syncDerivedMetricsToStore]);

  const resetAnalytics = useCallback(() => {
    stopAudioAndSpeech();
    finalizedWordsRef.current = 0;
    interimWordsRef.current = 0;
    syllableCountRef.current = 0;
    burstArmedRef.current = true;
    lastSyllableMsRef.current = 0;
    startElapsedRef.current = null;
    firstSpeechSecRef.current = null;
    wordSamplesRef.current = [];
    wordsRef.current = [];
    wordCountRef.current = 0;
    liveTranscriptRef.current = '';
    livePauseMsRef.current = 0;
    committedPausesRef.current = { pauseCount: 0, totalPauseMs: 0, gaps: [] };
    lastWordActivityAtRef.current = null;
    lastFullTextWordCountRef.current = 0;
    lastFullTextValueRef.current = '';
    hasPartialStreamingRef.current = false;
    loggedGapCountRef.current = 0;
    lastTimelineBucketRef.current = -1;

    setIsSimulatingSilence(false);

    const hasSpeechApi =
      typeof window !== 'undefined' &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const nextMethod = hasSpeechApi && !isSimulatedMicRef.current ? 'speech_api' : 'audio_burst';
    estimationMethodRef.current = nextMethod;

    const currentProgress = store.getState().modelProgress;
    store.reset();
    store.patch({
      isPro: isProRef.current,
      userFillerWords: userFillerWordsRef.current,
      activeLang: speechLangRef.current,
      wasmMode: detectWasmMode(),
      estimationMethod: nextMethod,
      modelProgress: currentProgress,
    });
  }, [stopAudioAndSpeech, store]);

  return {
    get rmsLevel() {
      return liveRmsRef.current;
    },
    frequencyBars: INITIAL_BARS,
    liveRmsRef,
    liveBarsRef,
    wordCount: snapshot.wordCount,
    words: snapshot.committedWords,
    setWordCount,
    wpm: snapshot.wpm,
    rollingWpm: snapshot.rollingWpm,
    pacingZone: snapshot.pacingZone,
    pauseCount: snapshot.longPausesCount,
    totalPauseSec: snapshot.totalPauseSec,
    isSilentPause: snapshot.isPausedLive,
    isSpeaking: snapshot.isSpeaking,
    currentSilenceSec: snapshot.currentSilenceSec,
    estimationMethod: snapshot.estimationMethod,
    setEstimationMethod,
    silenceThreshold,
    setSilenceThreshold,
    noiseThreshold: silenceThreshold,
    setNoiseThreshold: setSilenceThreshold,
    isSimulatedMic,
    setIsSimulatedMic,
    isSimulatingSilence,
    setIsSimulatingSilence,
    micError: snapshot.micError,
    engineError: snapshot.engineError,
    liveTranscript: snapshot.fullText,
    transcript: snapshot.fullText,
    committedBlocks: snapshot.committedBlocks,
    partialText: snapshot.partialText,
    wasmMode: snapshot.wasmMode,
    fillerCount: snapshot.fillerCount,
    fillerBreakdown: snapshot.fillerBreakdown,
    pacingTimeline: snapshot.pacingTimeline,
    modelProgress: snapshot.modelProgress,
    resetAnalytics,
  };
}
