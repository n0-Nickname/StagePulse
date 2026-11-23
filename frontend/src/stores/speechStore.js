import { useSyncExternalStore } from 'react';

export const COMMITTED_BLOCK_WORD_SIZE = 60;
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const DEFAULT_MODEL_PROGRESS = Object.freeze({ percent: 100, cached: true, ready: true });

export function detectWasmMode() {
  const mtSupported =
    Boolean(globalThis.crossOriginIsolated) &&
    typeof SharedArrayBuffer !== 'undefined' &&
    (globalThis.navigator?.hardwareConcurrency || 1) > 1;
  return mtSupported ? 'MT-WASM' : 'ST-WASM';
}

export function joinWordsText(words = []) {
  let out = '';
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (!w || !w.text) continue;
    if (!out || w.join) {
      out += w.text;
    } else {
      out += ` ${w.text}`;
    }
  }
  return out.trim();
}

export function buildCommittedBlocks(
  words = [],
  prevBlocks = EMPTY_ARRAY,
  blockSize = COMMITTED_BLOCK_WORD_SIZE
) {
  if (!Array.isArray(words) || words.length === 0) {
    return EMPTY_ARRAY;
  }

  const blockCount = Math.ceil(words.length / blockSize);
  const nextBlocks = new Array(blockCount);
  let allSame = prevBlocks.length === blockCount;

  for (let b = 0; b < blockCount; b += 1) {
    const start = b * blockSize;
    const end = Math.min(words.length, start + blockSize);
    const count = end - start;
    const prev = prevBlocks[b];

    if (
      prev &&
      prev.words.length === count &&
      prev.words[0] === words[start] &&
      prev.words[count - 1] === words[end - 1]
    ) {
      nextBlocks[b] = prev;
    } else {
      allSame = false;
      const slice = words.slice(start, end);
      nextBlocks[b] = {
        id: `block-${b}`,
        index: b,
        words: slice,
        text: joinWordsText(slice),
      };
    }
  }

  return allSame ? prevBlocks : nextBlocks;
}

export function computePartialText(words = [], fullText = '') {
  const committedText = joinWordsText(words);
  if (!fullText) {
    return { committedText, partialText: '' };
  }
  if (committedText && fullText.startsWith(committedText)) {
    return {
      committedText,
      partialText: fullText.slice(committedText.length).trim(),
    };
  }
  if (words.length === 0) {
    return { committedText: '', partialText: fullText };
  }
  return { committedText, partialText: '' };
}

function shallowEqual(a, b) {
  const keys = Object.keys(a);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

function createInitialRawState() {
  return {
    wpm: 0,
    rollingWpm: 0,
    wordCount: 0,
    pacingZone: 'warming_up',
    longPausesCount: 0,
    activePauseMs: 0,
    isPausedLive: false,
    isSpeaking: false,
    totalPauseSec: 0,
    currentSilenceSec: 0,
    fillerCount: 0,
    fillerBreakdown: EMPTY_OBJECT,
    committedWords: EMPTY_ARRAY,
    committedBlocks: EMPTY_ARRAY,
    committedText: '',
    partialText: '',
    fullText: '',
    pacingTimeline: EMPTY_ARRAY,
    isRecording: false,
    isWarmingUp: false,
    wasmMode: detectWasmMode(),
    activeLang: 'uk-UA',
    engineError: null,
    micError: null,
    estimationMethod: 'speech_api',
    modelProgress: DEFAULT_MODEL_PROGRESS,
  };
}

function buildSnapshot(raw, prevSnap) {
  const wpmCandidate = {
    wpm: raw.wpm,
    rollingWpm: raw.rollingWpm,
    wordCount: raw.wordCount,
    pacingZone: raw.pacingZone,
  };
  const pauseCandidate = {
    longPausesCount: raw.longPausesCount,
    activePauseMs: raw.activePauseMs,
    isPausedLive: raw.isPausedLive,
    totalPauseSec: raw.totalPauseSec,
    currentSilenceSec: raw.currentSilenceSec,
  };
  const fillerCandidate = {
    fillerCount: raw.fillerCount,
    fillerWords: raw.fillerBreakdown,
    fillerBreakdown: raw.fillerBreakdown,
  };
  const committedCandidate = {
    committedBlocks: raw.committedBlocks,
    committedText: raw.committedText,
  };
  const tailCandidate = {
    partialText: raw.partialText,
    fullText: raw.fullText,
  };
  const transcriptCandidate = {
    committedBlocks: raw.committedBlocks,
    committedText: raw.committedText,
    partialText: raw.partialText,
    fullText: raw.fullText,
  };
  const statusCandidate = {
    isRecording: raw.isRecording,
    isWarmingUp: raw.isWarmingUp,
    wasmMode: raw.wasmMode,
    activeLang: raw.activeLang,
    error: raw.engineError || raw.micError || null,
    engineError: raw.engineError,
    micError: raw.micError,
    estimationMethod: raw.estimationMethod,
    modelProgress: raw.modelProgress,
  };

  return {
    ...raw,
    wpmMetrics:
      prevSnap && shallowEqual(prevSnap.wpmMetrics, wpmCandidate)
        ? prevSnap.wpmMetrics
        : wpmCandidate,
    pauseMetrics:
      prevSnap && shallowEqual(prevSnap.pauseMetrics, pauseCandidate)
        ? prevSnap.pauseMetrics
        : pauseCandidate,
    fillerMetrics:
      prevSnap && shallowEqual(prevSnap.fillerMetrics, fillerCandidate)
        ? prevSnap.fillerMetrics
        : fillerCandidate,
    transcriptCommitted:
      prevSnap && shallowEqual(prevSnap.transcriptCommitted, committedCandidate)
        ? prevSnap.transcriptCommitted
        : committedCandidate,
    transcriptTail:
      prevSnap && shallowEqual(prevSnap.transcriptTail, tailCandidate)
        ? prevSnap.transcriptTail
        : tailCandidate,
    transcriptState:
      prevSnap && shallowEqual(prevSnap.transcriptState, transcriptCandidate)
        ? prevSnap.transcriptState
        : transcriptCandidate,
    sessionStatus:
      prevSnap && shallowEqual(prevSnap.sessionStatus, statusCandidate)
        ? prevSnap.sessionStatus
        : statusCandidate,
  };
}

export function createSpeechStore() {
  let rawState = createInitialRawState();
  let snapshot = buildSnapshot(rawState, null);
  const listeners = new Set();

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getState = () => snapshot;

  const patch = (partial) => {
    if (!partial || typeof partial !== 'object') return;
    const nextRaw = { ...rawState, ...partial };
    if (shallowEqual(rawState, nextRaw)) return;
    rawState = nextRaw;
    snapshot = buildSnapshot(rawState, snapshot);
    listeners.forEach((listener) => listener());
  };

  const reset = () => {
    rawState = createInitialRawState();
    snapshot = buildSnapshot(rawState, snapshot);
    listeners.forEach((listener) => listener());
  };

  return { subscribe, getState, patch, reset };
}

export const speechStore = createSpeechStore();

export function useWpmMetrics(store = speechStore) {
  return useSyncExternalStore(store.subscribe, () => store.getState().wpmMetrics);
}

export function usePauseMetrics(store = speechStore) {
  return useSyncExternalStore(store.subscribe, () => store.getState().pauseMetrics);
}

export function useFillerMetrics(store = speechStore) {
  return useSyncExternalStore(store.subscribe, () => store.getState().fillerMetrics);
}

export function useTranscriptCommitted(store = speechStore) {
  return useSyncExternalStore(store.subscribe, () => store.getState().transcriptCommitted);
}

export function useTranscriptTail(store = speechStore) {
  return useSyncExternalStore(store.subscribe, () => store.getState().transcriptTail);
}

export function useTranscriptState(store = speechStore) {
  return useSyncExternalStore(store.subscribe, () => store.getState().transcriptState);
}

export function useSessionStatus(store = speechStore) {
  return useSyncExternalStore(store.subscribe, () => store.getState().sessionStatus);
}

export function useSpeechSnapshot(store = speechStore) {
  return useSyncExternalStore(store.subscribe, store.getState);
}
