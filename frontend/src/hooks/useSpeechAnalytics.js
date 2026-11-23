import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { startMicCapture } from '../audio/micCapture.js';
import { createDefaultAsrEngine } from '../services/asrAdapter.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ASR:Analytics');

const DEFAULT_SILENCE_THRESHOLD = 0.018;
const MIN_SPEECH_THRESHOLD = 0.015;
const PAUSE_DURATION_THRESHOLD_MS = 1500;
const SPEAKING_TO_SILENT_HYSTERESIS_MS = 350;
const SILENT_TO_SPEAKING_HYSTERESIS_MS = 120;
const ASR_VETO_WINDOW_MS = 800;
const NOISE_FLOOR_EMA_ALPHA = 0.08;
const SPEECH_BURST_DIP_FACTOR = 1.22;
const SPEECH_BURST_PEAK_FACTOR = 1.95;
const SYLLABLE_COOLDOWN_MS = 140;
const BAR_COUNT = 24;
const TRANSCRIPT_THROTTLE_MS = 135;
const RMS_STATE_THROTTLE_MS = 1000;
const ROLLING_WPM_WINDOW_SEC = 15;
const CACHE_NAME = 'tinyasr-models-v1';
const MODEL_CACHE_KEYS = ['/models/en-ru-uk.tzf.gz', '/models/silero_vad.onnx.gz'];

export const BILINGUAL_FILLER_WORDS = {
  uk: ['ну', 'типу', 'короче', 'блін', 'як би', 'власне', 'значить', 'от'],
  en: ['like', 'um', 'uh', 'basically', 'actually', 'literally', 'you know', 'so'],
};

export function normalizeWordTimestamps(words = []) {
  return words.map((w) => ({
    ...w,
    startMs: w.startMs !== undefined ? w.startMs : Math.round((w.start ?? 0) * 1000),
    endMs: w.endMs !== undefined ? w.endMs : Math.round((w.end ?? 0) * 1000),
  }));
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
  let pauseCount = 0;
  let totalPauseMs = 0;

  for (let i = 1; i < normalized.length; i += 1) {
    const gapMs = normalized[i].startMs - normalized[i - 1].endMs;
    if (gapMs >= thresholdMs) {
      pauseCount += 1;
      totalPauseMs += gapMs;
    }
  }

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

export function analyzeFillers(text, speechLang = 'uk-UA') {
  if (!text) {
    return { fillerCount: 0, fillerBreakdown: {} };
  }
  const langKey = speechLang.startsWith('uk') ? 'uk' : 'en';
  const dict = BILINGUAL_FILLER_WORDS[langKey];
  const counts = {};
  let total = 0;

  for (const phrase of dict) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      counts[phrase] = matches.length;
      total += matches.length;
    }
  }

  return { fillerCount: total, fillerBreakdown: counts };
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
  const { engineFactory, micCaptureFactory = startMicCapture } = options;

  const [rmsLevel, setRmsLevel] = useState(0);
  const [frequencyBars, setFrequencyBars] = useState(() => new Array(BAR_COUNT).fill(0.05));
  const [wordCount, setWordCount] = useState(0);
  const [words, setWords] = useState([]);
  const [pauseCount, setPauseCount] = useState(0);
  const [totalPauseSec, setTotalPauseSec] = useState(0);
  const [isSilentPause, setIsSilentPause] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentSilenceSec, setCurrentSilenceSec] = useState(0);
  const [estimationMethod, setEstimationMethod] = useState('speech_api');
  const [silenceThreshold, setSilenceThreshold] = useState(DEFAULT_SILENCE_THRESHOLD);
  const [isSimulatedMic, setIsSimulatedMic] = useState(false);
  const [isSimulatingSilence, setIsSimulatingSilence] = useState(false);
  const [micError, setMicError] = useState(null);
  const [engineError, setEngineError] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [pacingTimeline, setPacingTimeline] = useState([]);
  const [modelProgress, setModelProgress] = useState({
    percent: 100,
    cached: true,
    ready: true,
  });

  const lastTimelineBucketRef = useRef(-1);

  // Zero-rerender audio meter refs driven via rAF in AudioVisualizer
  const liveRmsRef = useRef(0);
  const liveBarsRef = useRef(new Array(BAR_COUNT).fill(0.05));
  const rmsStateRef = useRef(0);
  const lastRmsStateFlushMsRef = useRef(null);

  // Active speaking WPM & rolling 15s WPM refs
  const activeElapsedSecRef = useRef(activeElapsedSec);
  const startElapsedRef = useRef(null);
  const firstSpeechSecRef = useRef(null);
  const wordSamplesRef = useRef([]);

  // Transcript throttle, ASR 800ms veto, RMS hysteresis & noiseFloor EMA refs
  const transcriptTimerRef = useRef(null);
  const pendingTranscriptRef = useRef(null);
  const lastTranscriptFlushMsRef = useRef(null);
  const lastAsrActivityWallMsRef = useRef(null);
  const lastAsrTextRef = useRef('');
  const lastCommittedCountRef = useRef(0);
  const speechStateRef = useRef('speaking');
  const belowThresholdSinceMsRef = useRef(null);
  const aboveThresholdSinceMsRef = useRef(null);
  const noiseFloorRef = useRef(null);
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
  const estimationMethodRef = useRef(estimationMethod);
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

  const silenceStartMsRef = useRef(null);
  const lastFrameMsRef = useRef(null);
  const totalPauseSecRef = useRef(0);
  const pauseCountRef = useRef(0);

  // Speech & Syllable Burst counters
  const finalizedWordsRef = useRef(0);
  const interimWordsRef = useRef(0);
  const syllableCountRef = useRef(0);
  const burstArmedRef = useRef(true);
  const lastSyllableMsRef = useRef(0);

  useEffect(() => {
    activeElapsedSecRef.current = activeElapsedSec;
  }, [activeElapsedSec]);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

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
    estimationMethodRef.current = estimationMethod;
  }, [estimationMethod]);

  useEffect(() => {
    speechLangRef.current = speechLang;
  }, [speechLang]);

  useEffect(() => {
    engineFactoryRef.current = engineFactory;
  }, [engineFactory]);

  useEffect(() => {
    micCaptureFactoryRef.current = micCaptureFactory;
  }, [micCaptureFactory]);

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
    if (speechStateRef.current === 'silent' && silenceStartMsRef.current !== null) {
      const pauseDurationMs = Math.max(0, performance.now() - silenceStartMsRef.current);
      if (pauseDurationMs >= PAUSE_DURATION_THRESHOLD_MS) {
        pauseCountRef.current += 1;
        totalPauseSecRef.current += pauseDurationMs / 1000;
        setPauseCount(pauseCountRef.current);
        setTotalPauseSec(Number(totalPauseSecRef.current.toFixed(1)));
        logger.debug('Speech state transition: silent -> finish', {
          pauseDurationMs: Math.round(pauseDurationMs),
        });
      }
    }
    analyserRef.current = null;
    lastFrameMsRef.current = null;
    silenceStartMsRef.current = null;
    speechStateRef.current = 'speaking';
    belowThresholdSinceMsRef.current = null;
    aboveThresholdSinceMsRef.current = null;
    noiseFloorRef.current = null;
    liveRmsRef.current = 0;
    liveBarsRef.current = new Array(BAR_COUNT).fill(0.05);
    rmsStateRef.current = 0;
    lastRmsStateFlushMsRef.current = null;
    lastTranscriptFlushMsRef.current = null;
    lastAsrActivityWallMsRef.current = null;
    lastAsrTextRef.current = '';
    lastCommittedCountRef.current = 0;
    setIsSilentPause(false);
    setIsSpeaking(false);
    setCurrentSilenceSec(0);
    setRmsLevel(0);
    setFrequencyBars(new Array(BAR_COUNT).fill(0.05));
  }, []);

  const pushAudioRms = useCallback((rms, bars) => {
    const normalizedRms = Math.min(1, rms / 0.15);
    liveRmsRef.current = normalizedRms;
    liveBarsRef.current = bars || buildBarsFromRms(rms);

    const now = performance.now();
    if (
      (rmsStateRef.current === 0 && normalizedRms > 0) ||
      lastRmsStateFlushMsRef.current === null ||
      now - lastRmsStateFlushMsRef.current >= RMS_STATE_THROTTLE_MS
    ) {
      lastRmsStateFlushMsRef.current = now;
      rmsStateRef.current = normalizedRms;
      setRmsLevel(normalizedRms);
    }
  }, []);

  const stepRmsPauseState = useCallback((rms, now, overrideThreshold = null) => {
    const threshold =
      overrideThreshold !== null
        ? overrideThreshold
        : Math.max(
            MIN_SPEECH_THRESHOLD,
            Number(((noiseFloorRef.current ?? 0.004) * 2.5).toFixed(4))
          );
    const asrVetoActive =
      lastAsrActivityWallMsRef.current !== null &&
      now - lastAsrActivityWallMsRef.current < ASR_VETO_WINDOW_MS;

    if (speechStateRef.current === 'speaking') {
      if (rms >= threshold || asrVetoActive) {
        belowThresholdSinceMsRef.current = null;
        setIsSpeaking(true);
      } else if (belowThresholdSinceMsRef.current === null) {
        belowThresholdSinceMsRef.current = now;
      } else if (now - belowThresholdSinceMsRef.current >= SPEAKING_TO_SILENT_HYSTERESIS_MS) {
        speechStateRef.current = 'silent';
        silenceStartMsRef.current = belowThresholdSinceMsRef.current;
        aboveThresholdSinceMsRef.current = null;
        setIsSpeaking(false);
        logger.debug('Speech state transition: speaking -> silent', {
          rms: Number(rms.toFixed(5)),
          threshold,
          silenceStartMs: silenceStartMsRef.current,
        });
      }
      return;
    }

    if (rms >= threshold) {
      if (aboveThresholdSinceMsRef.current === null) {
        aboveThresholdSinceMsRef.current = now;
      } else if (now - aboveThresholdSinceMsRef.current >= SILENT_TO_SPEAKING_HYSTERESIS_MS) {
        const pauseDurationMs =
          silenceStartMsRef.current !== null ? Math.max(0, now - silenceStartMsRef.current) : 0;
        if (pauseDurationMs >= PAUSE_DURATION_THRESHOLD_MS) {
          pauseCountRef.current += 1;
          totalPauseSecRef.current += pauseDurationMs / 1000;
          setPauseCount(pauseCountRef.current);
          setTotalPauseSec(Number(totalPauseSecRef.current.toFixed(1)));
        }
        logger.debug('Speech state transition: silent -> speaking', {
          rms: Number(rms.toFixed(5)),
          threshold,
          pauseDurationMs: Math.round(pauseDurationMs),
        });
        speechStateRef.current = 'speaking';
        silenceStartMsRef.current = null;
        belowThresholdSinceMsRef.current = null;
        aboveThresholdSinceMsRef.current = null;
        setIsSpeaking(true);
        setIsSilentPause(false);
        setCurrentSilenceSec(0);
      }
      return;
    }

    aboveThresholdSinceMsRef.current = null;
    noiseFloorRef.current =
      noiseFloorRef.current === null
        ? rms
        : noiseFloorRef.current * (1 - NOISE_FLOOR_EMA_ALPHA) + rms * NOISE_FLOOR_EMA_ALPHA;
    const ongoingMs =
      silenceStartMsRef.current !== null ? Math.max(0, now - silenceStartMsRef.current) : 0;
    if (ongoingMs >= PAUSE_DURATION_THRESHOLD_MS) {
      setIsSilentPause(true);
      setCurrentSilenceSec(Number((ongoingMs / 1000).toFixed(1)));
    }
  }, []);

  const handleWasmRms = useCallback(
    (rms) => {
      pushAudioRms(rms);
      stepRmsPauseState(rms, performance.now());
    },
    [pushAudioRms, stepRmsPauseState]
  );

  const markFirstSpeechDetected = useCallback(() => {
    if (firstSpeechSecRef.current === null) {
      const elapsed = activeElapsedSecRef.current;
      const startAt = startElapsedRef.current ?? elapsed;
      firstSpeechSecRef.current = elapsed > startAt ? elapsed : 0;
    }
  }, []);

  const markAsrActivity = useCallback((payload) => {
    const safeWords = Array.isArray(payload?.words) ? payload.words : [];
    const nextText = payload?.fullText || '';
    const textChanged = nextText !== lastAsrTextRef.current;
    const wordsGrew = safeWords.length > lastCommittedCountRef.current;

    lastAsrTextRef.current = nextText;
    lastCommittedCountRef.current = safeWords.length;

    // Veto only: cancel any active pause candidate without recording a pause
    if ((textChanged && nextText) || wordsGrew || (!payload?.isFinal && nextText)) {
      lastAsrActivityWallMsRef.current = performance.now();
      belowThresholdSinceMsRef.current = null;
      aboveThresholdSinceMsRef.current = null;
      if (speechStateRef.current === 'silent') {
        speechStateRef.current = 'speaking';
        silenceStartMsRef.current = null;
        setIsSilentPause(false);
        setCurrentSilenceSec(0);
      }
      setIsSpeaking(true);
    }
  }, []);

  const applyTranscriptPayload = useCallback(
    (payload) => {
      const safeWords = Array.isArray(payload?.words) ? payload.words : [];
      const fullText = payload?.fullText || '';
      const liveWordsCount = Math.max(countNormalizedWords(fullText), safeWords.length);
      if (liveWordsCount > 0) {
        markFirstSpeechDetected();
      }
      setWords(safeWords);
      setWordCount(liveWordsCount);
      setLiveTranscript(fullText);
    },
    [markFirstSpeechDetected]
  );

  const handleThrottledTranscript = useCallback(
    (payload) => {
      markAsrActivity(payload);
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
    [applyTranscriptPayload]
  );

  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognitionCtor =
      typeof window !== 'undefined' &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!SpeechRecognitionCtor || isSimulatedMicRef.current) {
      setEstimationMethod('audio_burst');
      estimationMethodRef.current = 'audio_burst';
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
        }
        setWordCount(nextTotal);
        if (recentText) {
          setLiveTranscript(recentText.slice(-90));
        }
      };

      recognition.onerror = (event) => {
        if (event.error) {
          setEstimationMethod('audio_burst');
          estimationMethodRef.current = 'audio_burst';
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
            estimationMethodRef.current = 'audio_burst';
          }
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      setEstimationMethod('audio_burst');
      estimationMethodRef.current = 'audio_burst';
    }
  }, []);

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

      if (lastFrameMsRef.current === null) {
        lastFrameMsRef.current = now;
      }
      const dtMs = Math.min(200, Math.max(0, now - lastFrameMsRef.current));
      lastFrameMsRef.current = now;

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

      // Pause Detection State Machine (RMS + hysteresis)
      stepRmsPauseState(rms, now, threshold);

      // Syllable Energy Burst Detector
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
        if (silenceStartMsRef.current !== null) {
          setCurrentSilenceSec(Number(((now - silenceStartMsRef.current) / 1000).toFixed(1)));
        } else {
          setCurrentSilenceSec(0);
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, [pushAudioRms, stepRmsPauseState]);

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
    setModelProgress({ percent: 0, cached: false, ready: false });

    const initPromise = adapter
      .init({
        lang: activeLang,
        onProgress: ({ percent, cached }) => {
          if (liveCallbacksRef.current.onProgress) {
            liveCallbacksRef.current.onProgress({ percent, cached });
          } else if (!cancelled) {
            setModelProgress({ percent, cached, ready: percent >= 100 });
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
              setEngineError(err?.message || 'ASR engine error');
              setModelProgress({ percent: 0, cached: false, ready: false });
            }
          }
        },
      })
      .then(() => {
        if (!cancelled && !liveCallbacksRef.current.onProgress) {
          setModelProgress((prev) => ({ ...prev, percent: 100, ready: true }));
        }
      });

    // Attach catch so idle warmup rejection doesn't create an unhandled rejection before Start
    initPromise.catch(() => {});
    warmedEngineRef.current = { adapter, lang: activeLang, initPromise };

    return () => {
      cancelled = true;
    };
  }, [isRunning, isSimulatedMic, speechLang]);

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
        estimationMethodRef.current = 'audio_burst';
        startAnalysisLoop();
        return;
      }

      setMicError(null);
      setEngineError(null);

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
          setModelProgress({ percent: 0, cached: false, ready: false });
        }

        const onProgressCb = ({ percent, cached }) => {
          if (!cancelled) {
            setModelProgress({
              percent,
              cached,
              ready: percent >= 100,
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
            setEngineError(err?.message || 'ASR engine error');
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

          setModelProgress((prev) => ({ ...prev, percent: 100, ready: true }));
          setEstimationMethod('speech_api');
          estimationMethodRef.current = 'speech_api';

          const capture = await micCaptureFactoryRef.current({
            onChunk: (chunk) => adapter.pushAudio(chunk),
            onRms: (rms) => handleWasmRms(rms),
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
          // If microphone itself failed, switch to Demo Speech Simulator
          if (err?.message && /mediaDevices|Permission|Audio/i.test(err.message)) {
            logger.error('Mic capture error in WASM pipeline', { err });
            if (!cancelled) {
              setMicError(err.message);
              setIsSimulatedMic(true);
              isSimulatedMicRef.current = true;
              setEstimationMethod('audio_burst');
              estimationMethodRef.current = 'audio_burst';
              startAnalysisLoop();
            }
            return;
          }
          logger.error('WASM ASR pipeline failed, falling back to legacy speech/burst', { err });
          if (!cancelled) {
            setEngineError(err?.message || 'ASR engine initialization failed');
            setModelProgress({ percent: 0, cached: false, ready: false });
          }
          // Fall through to Web Speech / Audio Burst fallback
        }
      }

      try {
        await initLegacyMicPipeline();
      } catch (err) {
        if (cancelled) return;
        setMicError(
          err?.message || 'Microphone unavailable — switched to Demo Speech Simulator'
        );
        setIsSimulatedMic(true);
        isSimulatedMicRef.current = true;
        setEstimationMethod('audio_burst');
        estimationMethodRef.current = 'audio_burst';
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
    handleWasmRms,
    startAnalysisLoop,
    startSpeechRecognition,
    stopAudioAndSpeech,
  ]);

  const resetAnalytics = useCallback(() => {
    stopAudioAndSpeech();
    silenceStartMsRef.current = null;
    speechStateRef.current = 'speaking';
    belowThresholdSinceMsRef.current = null;
    aboveThresholdSinceMsRef.current = null;
    noiseFloorRef.current = null;
    lastFrameMsRef.current = null;
    totalPauseSecRef.current = 0;
    pauseCountRef.current = 0;
    finalizedWordsRef.current = 0;
    interimWordsRef.current = 0;
    syllableCountRef.current = 0;
    burstArmedRef.current = true;
    lastSyllableMsRef.current = 0;
    startElapsedRef.current = null;
    firstSpeechSecRef.current = null;
    wordSamplesRef.current = [];
    lastAsrActivityWallMsRef.current = null;
    lastAsrTextRef.current = '';
    lastCommittedCountRef.current = 0;

    setRmsLevel(0);
    setFrequencyBars(new Array(BAR_COUNT).fill(0.05));
    setWordCount(0);
    setWords([]);
    setPauseCount(0);
    setTotalPauseSec(0);
    setIsSilentPause(false);
    setIsSpeaking(false);
    setCurrentSilenceSec(0);
    setLiveTranscript('');
    setPacingTimeline([]);
    lastTimelineBucketRef.current = -1;
    setMicError(null);
    setEngineError(null);
    setIsSimulatingSilence(false);

    const hasSpeechApi =
      typeof window !== 'undefined' &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const nextMethod = hasSpeechApi && !isSimulatedMicRef.current ? 'speech_api' : 'audio_burst';
    setEstimationMethod(nextMethod);
    estimationMethodRef.current = nextMethod;
  }, [stopAudioAndSpeech]);

  // Pauses are computed strictly from audio RMS + hysteresis (decoupled from TRANSCRIPT_UPDATE cadence)
  const effectivePauseCount = pauseCount;
  const effectiveTotalPauseSec = totalPauseSec;
  const effectiveIsSilentPause = isSilentPause;
  const effectiveCurrentSilenceSec = currentSilenceSec;

  // Synchronize active-speech start timestamp and 15s rolling word samples before computing WPM
  if (isRunning) {
    if (startElapsedRef.current === null) {
      startElapsedRef.current = activeElapsedSec;
    }
    if (wordCount > 0) {
      const samples = wordSamplesRef.current;
      const last = samples[samples.length - 1];
      if (last && last.t === activeElapsedSec) {
        last.words = wordCount;
      } else {
        samples.push({ t: activeElapsedSec, words: wordCount });
      }
    }
  }

  const speakingElapsedSec = Math.max(0, activeElapsedSec - (firstSpeechSecRef.current ?? 0));

  const wpm = useMemo(() => {
    return computeOverallWpm(wordCount, speakingElapsedSec);
  }, [speakingElapsedSec, wordCount]);

  const rollingWpm = useMemo(() => {
    return computeRollingWpm(
      wordSamplesRef.current,
      activeElapsedSec,
      firstSpeechSecRef.current ?? 0
    );
  }, [activeElapsedSec, wordCount]);

  // Record 10-second pacing timeline snapshots while running
  useEffect(() => {
    if (!isRunning || activeElapsedSec <= 0) return;
    const bucket = Math.floor(activeElapsedSec / 10);
    if (
      bucket > lastTimelineBucketRef.current &&
      activeElapsedSec >= 10 &&
      activeElapsedSec % 10 === 0
    ) {
      lastTimelineBucketRef.current = bucket;
      setPacingTimeline((prev) => [...prev, { sec: activeElapsedSec, wpm }]);
    }
  }, [isRunning, activeElapsedSec, wpm]);

  const { fillerCount, fillerBreakdown } = useMemo(
    () => analyzeFillers(liveTranscript, speechLang),
    [liveTranscript, speechLang]
  );

  const pacingZone = useMemo(() => {
    if (wpm === 0) return 'warming_up';
    if (wpm < 110) return 'too_slow';
    if (wpm <= 160) return 'optimal';
    return 'too_fast';
  }, [wpm]);

  return {
    rmsLevel,
    frequencyBars,
    liveRmsRef,
    liveBarsRef,
    wordCount,
    words,
    setWordCount,
    wpm,
    rollingWpm,
    pacingZone,
    pauseCount: effectivePauseCount,
    totalPauseSec: effectiveTotalPauseSec,
    isSilentPause: effectiveIsSilentPause,
    isSpeaking,
    currentSilenceSec: effectiveCurrentSilenceSec,
    estimationMethod,
    setEstimationMethod,
    silenceThreshold,
    setSilenceThreshold,
    noiseThreshold: silenceThreshold,
    setNoiseThreshold: setSilenceThreshold,
    isSimulatedMic,
    setIsSimulatedMic,
    isSimulatingSilence,
    setIsSimulatingSilence,
    micError,
    engineError,
    liveTranscript,
    transcript: liveTranscript,
    fillerCount,
    fillerBreakdown,
    pacingTimeline,
    modelProgress,
    resetAnalytics,
  };
}
