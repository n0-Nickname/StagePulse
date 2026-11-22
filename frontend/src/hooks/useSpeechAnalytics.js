import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FILLER_WORDS } from '../utils/roastGenerator.js';

const DEFAULT_SILENCE_THRESHOLD = 0.018;
const PAUSE_DURATION_THRESHOLD_MS = 1500;
const SPEECH_BURST_DIP_FACTOR = 1.22;
const SPEECH_BURST_PEAK_FACTOR = 1.95;
const SYLLABLE_COOLDOWN_MS = 140;
const BAR_COUNT = 24;

export function useSpeechAnalytics(isRunning, activeElapsedSec, speechLang = 'uk-UA') {
  const [rmsLevel, setRmsLevel] = useState(0);
  const [frequencyBars, setFrequencyBars] = useState(() => new Array(BAR_COUNT).fill(0.05));
  const [wordCount, setWordCount] = useState(0);
  const [pauseCount, setPauseCount] = useState(0);
  const [totalPauseSec, setTotalPauseSec] = useState(0);
  const [isSilentPause, setIsSilentPause] = useState(false);
  const [currentSilenceSec, setCurrentSilenceSec] = useState(0);
  const [estimationMethod, setEstimationMethod] = useState('speech_api');
  const [silenceThreshold, setSilenceThreshold] = useState(DEFAULT_SILENCE_THRESHOLD);
  const [isSimulatedMic, setIsSimulatedMic] = useState(false);
  const [isSimulatingSilence, setIsSimulatingSilence] = useState(false);
  const [micError, setMicError] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [fillerCount, setFillerCount] = useState(0);
  const [fillerBreakdown, setFillerBreakdown] = useState({});
  const [pacingTimeline, setPacingTimeline] = useState([]);

  const lastTimelineBucketRef = useRef(-1);
  const finalizedTranscriptRef = useRef('');

  // Mutable refs for 60fps loop without stale closures
  const isRunningRef = useRef(isRunning);
  const silenceThresholdRef = useRef(silenceThreshold);
  const isSimulatedMicRef = useRef(isSimulatedMic);
  const isSimulatingSilenceRef = useRef(isSimulatingSilence);
  const estimationMethodRef = useRef(estimationMethod);
  const speechLangRef = useRef(speechLang);

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const rafIdRef = useRef(null);
  const recognitionRef = useRef(null);

  const silenceStartMsRef = useRef(null);
  const isCurrentlyPausedRef = useRef(false);
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

  const stopAudioAndSpeech = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
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
    lastFrameMsRef.current = null;
    silenceStartMsRef.current = null;
    isCurrentlyPausedRef.current = false;
    setIsSilentPause(false);
    setCurrentSilenceSec(0);
    setRmsLevel(0);
    setFrequencyBars(new Array(BAR_COUNT).fill(0.05));
  }, []);

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

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.trim();
          if (!transcript) continue;
          const words = transcript
            .split(/[\s—–-]+/)
            .map((w) => w.replace(/^[^\p{L}\p{N}'’]+|[^\p{L}\p{N}'’]+$/gu, ''))
            .filter(Boolean).length;
          if (event.results[i].isFinal) {
            newFinalWords += words;
          } else {
            currentInterimWords += words;
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
        setWordCount(Math.max(speechTotal, burstEstimated));
        if (recentText) {
          setLiveTranscript(recentText.slice(-90));
        }
      };

      recognition.onerror = (event) => {
        const fatalErrors = ['network', 'not-allowed', 'service-not-allowed', 'audio-capture'];
        if (fatalErrors.includes(event.error) || event.error) {
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
          // Realistic speech cadence modulation (~3.5 syllables/sec with micro-gaps)
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
      } else if (analyserRef.current && timeDomainBuffer && freqBuffer) {
        analyserRef.current.getFloatTimeDomainData(timeDomainBuffer);
        let sumSquares = 0;
        for (let i = 0; i < timeDomainBuffer.length; i++) {
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

      // 1. Pause Detection State Machine (> 1.5s below SILENCE_THRESHOLD)
      if (rms < threshold) {
        if (silenceStartMsRef.current === null) {
          silenceStartMsRef.current = now;
        } else {
          const silentElapsedMs = now - silenceStartMsRef.current;
          if (silentElapsedMs >= PAUSE_DURATION_THRESHOLD_MS) {
            if (!isCurrentlyPausedRef.current) {
              isCurrentlyPausedRef.current = true;
              pauseCountRef.current += 1;
              totalPauseSecRef.current += PAUSE_DURATION_THRESHOLD_MS / 1000;
              setPauseCount(pauseCountRef.current);
              setIsSilentPause(true);
            } else {
              totalPauseSecRef.current += dtMs / 1000;
            }
            setTotalPauseSec(Number(totalPauseSecRef.current.toFixed(1)));
          }
        }
      } else {
        silenceStartMsRef.current = null;
        if (isCurrentlyPausedRef.current) {
          isCurrentlyPausedRef.current = false;
          setIsSilentPause(false);
        }
      }

      // 2. Syllable Energy Burst Detector (runs continuously for audio_burst fallback & hybrid reliability)
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
        if (estimationMethodRef.current === 'audio_burst') {
          setWordCount(burstWords);
        } else {
          const speechWords = finalizedWordsRef.current + interimWordsRef.current;
          if (burstWords > speechWords) {
            setWordCount(burstWords);
          }
        }
      }

      // 3. Throttled UI state updates (~20fps) to keep React snappy
      if (now - uiThrottleMs >= 50) {
        uiThrottleMs = now;
        const normalizedRms = Math.min(1, rms / 0.15);
        setRmsLevel(normalizedRms);
        if (bars) {
          setFrequencyBars(bars);
        }
        if (silenceStartMsRef.current !== null) {
          setCurrentSilenceSec(Number(((now - silenceStartMsRef.current) / 1000).toFixed(1)));
        } else {
          setCurrentSilenceSec(0);
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  // Manage lifecycle when `isRunning` changes
  useEffect(() => {
    let cancelled = false;

    async function initAudioAndSpeech() {
      if (!isRunning) {
        stopAudioAndSpeech();
        return;
      }

      setMicError(null);

      if (isSimulatedMicRef.current) {
        setEstimationMethod('audio_burst');
        estimationMethodRef.current = 'audio_burst';
        startAnalysisLoop();
        return;
      }

      try {
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
      } catch (err) {
        if (cancelled) return;
        // Automatic fallback to simulated mic if headless browser or permission denied
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
      stopAudioAndSpeech();
    };
  }, [isRunning, isSimulatedMic, startAnalysisLoop, startSpeechRecognition, stopAudioAndSpeech]);

  const resetAnalytics = useCallback(() => {
    stopAudioAndSpeech();
    silenceStartMsRef.current = null;
    isCurrentlyPausedRef.current = false;
    lastFrameMsRef.current = null;
    totalPauseSecRef.current = 0;
    pauseCountRef.current = 0;
    finalizedWordsRef.current = 0;
    interimWordsRef.current = 0;
    syllableCountRef.current = 0;
    burstArmedRef.current = true;
    lastSyllableMsRef.current = 0;

    setRmsLevel(0);
    setFrequencyBars(new Array(BAR_COUNT).fill(0.05));
    setWordCount(0);
    setPauseCount(0);
    setTotalPauseSec(0);
    setIsSilentPause(false);
    setCurrentSilenceSec(0);
    setLiveTranscript('');
    setFillerCount(0);
    setFillerBreakdown({});
    setPacingTimeline([]);
    lastTimelineBucketRef.current = -1;
    finalizedTranscriptRef.current = '';
    setMicError(null);
    setIsSimulatingSilence(false);

    const hasSpeechApi =
      typeof window !== 'undefined' &&
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    const nextMethod = hasSpeechApi && !isSimulatedMicRef.current ? 'speech_api' : 'audio_burst';
    setEstimationMethod(nextMethod);
    estimationMethodRef.current = nextMethod;
  }, [stopAudioAndSpeech]);

  const wpm = useMemo(() => {
    if (activeElapsedSec < 3 || wordCount <= 0) return 0;
    const activeSpeakingMinutes = Math.max((activeElapsedSec - totalPauseSec) / 60, 0.1);
    return Math.round(wordCount / activeSpeakingMinutes);
  }, [activeElapsedSec, totalPauseSec, wordCount]);

  // Record pacing timeline every 10 seconds while running
  useEffect(() => {
    if (!isRunning || activeElapsedSec <= 0) return;
    const bucket = Math.floor(activeElapsedSec / 10);
    if (bucket > lastTimelineBucketRef.current && activeElapsedSec >= 10 && activeElapsedSec % 10 === 0) {
      lastTimelineBucketRef.current = bucket;
      setPacingTimeline((prev) => [...prev, { sec: activeElapsedSec, wpm }]);
    }
  }, [isRunning, activeElapsedSec, wpm]);

  // Scan liveTranscript for filler words using whole-word Unicode regex
  useEffect(() => {
    if (!liveTranscript) {
      setFillerCount(0);
      setFillerBreakdown({});
      return;
    }
    const langKey = speechLang.startsWith('uk') ? 'uk' : 'en';
    const dict = FILLER_WORDS[langKey] || FILLER_WORDS.uk;
    const counts = {};
    let total = 0;

    for (const phrase of dict) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
      const matches = liveTranscript.match(regex);
      if (matches && matches.length > 0) {
        counts[phrase] = matches.length;
        total += matches.length;
      }
    }
    setFillerCount(total);
    setFillerBreakdown(counts);
  }, [liveTranscript, speechLang]);

  const pacingZone = useMemo(() => {
    if (wpm === 0) return 'warming_up';
    if (wpm < 110) return 'too_slow';
    if (wpm <= 160) return 'optimal';
    return 'too_fast';
  }, [wpm]);

  return {
    rmsLevel,
    frequencyBars,
    wordCount,
    setWordCount,
    wpm,
    pacingZone,
    pauseCount,
    totalPauseSec,
    isSilentPause,
    currentSilenceSec,
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
    liveTranscript,
    transcript: liveTranscript,
    fillerCount,
    fillerBreakdown,
    pacingTimeline,
    resetAnalytics,
  };
}
