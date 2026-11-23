import { createLogger } from '../utils/logger.js';

export const TARGET_SAMPLE_RATE = 16000;
export const CHUNK_SAMPLES = 640; // 40ms at 16kHz (within 40-60ms batch window)
export const SILENT_MIC_PEAK_THRESHOLD = 0.001;
export const SILENT_MIC_CHECK_MS = 2000;
const CHUNK_LOG_INTERVAL_MS = 2000;
const AGC_TARGET_RMS = 0.1;
const AGC_NOISE_GATE_RMS = 0.0004;
const AGC_MAX_GAIN = 25;

const logger = createLogger('Audio:Mic');

function sanitizeSample(val) {
  return Number.isFinite(val) ? val : 0;
}

function clampSample(val) {
  const s = sanitizeSample(val);
  if (s > 1) return 1;
  if (s < -1) return -1;
  return s;
}

/**
 * Lightweight AGC + tanh soft-limiter for speech frames.
 * Leaves sub-threshold silence (<0.001 RMS) unamplified so dead-mic fallback remains accurate.
 */
export function createAgcProcessor({
  targetRms = AGC_TARGET_RMS,
  noiseGateRms = AGC_NOISE_GATE_RMS,
  maxGain = AGC_MAX_GAIN,
} = {}) {
  let currentGain = 1;

  return (samples) => {
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = sanitizeSample(samples[i]);
    }
    const rms = computeRms(samples);
    const desiredGain =
      rms >= noiseGateRms ? Math.min(maxGain, Math.max(1, targetRms / rms)) : 1;
    const alpha = desiredGain > currentGain ? 0.25 : 0.4;
    currentGain += (desiredGain - currentGain) * alpha;

    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.tanh(samples[i] * currentGain);
    }
    return samples;
  };
}

export function computeRms(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const val = samples[i];
    sum += val * val;
  }
  return Math.sqrt(sum / samples.length);
}

export function computePeak(samples) {
  if (!samples || samples.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * 3-tap anti-aliased linear interpolation resampler from native `sourceRate` to 16kHz.
 * Buffers exact `chunkSize` (640 samples = 40ms) Float32Array frames.
 */
export function createResampler(sourceRate, chunkSize, onChunk, onRms) {
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  logger.debug('Resampler created', {
    inputRate: sourceRate,
    outputRate: TARGET_SAMPLE_RATE,
    chunkSize,
  });
  let outBuffer = new Float32Array(chunkSize);
  let outOffset = 0;
  let prev4 = 0;
  let prev3 = 0;
  let prev2 = 0;
  let prev1 = 0;
  let phase = 0;

  return (input) => {
    if (!input || input.length === 0) return;

    // 5-tap symmetric low-pass filter [0.06, 0.24, 0.40, 0.24, 0.06] before decimation
    const filtered = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const curr = input[i];
      filtered[i] =
        ratio > 1.05
          ? 0.06 * prev4 + 0.24 * prev3 + 0.4 * prev2 + 0.24 * prev1 + 0.06 * curr
          : curr;
      prev4 = prev3;
      prev3 = prev2;
      prev2 = prev1;
      prev1 = curr;
    }

    let pos = phase;
    while (pos < filtered.length - 1) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const sample = clampSample(filtered[idx] * (1 - frac) + filtered[idx + 1] * frac);
      outBuffer[outOffset] = sample;
      outOffset += 1;

      if (outOffset === chunkSize) {
        const ready = outBuffer;
        outBuffer = new Float32Array(chunkSize);
        outOffset = 0;
        onRms?.(computeRms(ready));
        onChunk?.(ready);
      }
      pos += ratio;
    }
    phase = pos - (filtered.length - 1);
  };
}

const WORKLET_CODE = `
class TinyAsrResampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / 16000;
    this._buffer = new Float32Array(640);
    this._offset = 0;
    this._prev4 = 0;
    this._prev3 = 0;
    this._prev2 = 0;
    this._prev1 = 0;
    this._phase = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    const n = channel.length;
    const filtered = new Float32Array(n);
    const applyFilter = this._ratio > 1.05;
    for (let i = 0; i < n; i++) {
      const curr = channel[i];
      filtered[i] = applyFilter
        ? 0.06 * this._prev4 + 0.24 * this._prev3 + 0.4 * this._prev2 + 0.24 * this._prev1 + 0.06 * curr
        : curr;
      this._prev4 = this._prev3;
      this._prev3 = this._prev2;
      this._prev2 = this._prev1;
      this._prev1 = curr;
    }
    let pos = this._phase;
    while (pos < n - 1) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s = filtered[idx] * (1 - frac) + filtered[idx + 1] * frac;
      this._buffer[this._offset++] = s > 1 ? 1 : s < -1 ? -1 : s;
      if (this._offset === 640) {
        const chunk = this._buffer;
        this._buffer = new Float32Array(640);
        this._offset = 0;
        this.port.postMessage(chunk, [chunk.buffer]);
      }
      pos += this._ratio;
    }
    this._phase = pos - (n - 1);
    return true;
  }
}
registerProcessor('tinyasr-resample-processor', TinyAsrResampleProcessor);
`;

async function openAudioPipeline({
  constraints,
  chunkSize,
  onChunk,
  onRms,
  onPeakSample,
}) {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const audioCtx = new AudioContextCtor();
  if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
    await audioCtx.resume();
  }
  const source = audioCtx.createMediaStreamSource(stream);
  const inputRate = audioCtx.sampleRate || TARGET_SAMPLE_RATE;
  logger.info('AudioContext opened', {
    sampleRate: audioCtx.sampleRate,
    inputRate,
    outputRate: TARGET_SAMPLE_RATE,
  });

  let workletNode = null;
  let scriptNode = null;
  let muteGain = null;
  let workletUrl = null;
  let lastChunkLogMs = 0;
  const processAgc = createAgcProcessor();

  const emitChunk = (rawSamples) => {
    const samples =
      rawSamples instanceof Float32Array ? rawSamples : new Float32Array(rawSamples);
    // Measure raw peak before AGC so dead/muted mic detection (<0.001) remains accurate
    onPeakSample?.(computePeak(samples));
    processAgc(samples);
    const rms = computeRms(samples);
    const chunkLength = samples.length;
    const now = performance.now();
    if (lastChunkLogMs === 0 || now - lastChunkLogMs >= CHUNK_LOG_INTERVAL_MS) {
      lastChunkLogMs = now;
      logger.debug('Mic audio chunk', {
        chunkLength,
        sampleRate: TARGET_SAMPLE_RATE,
        rms: Number(rms.toFixed(5)),
      });
    }
    onRms?.(rms);
    onChunk?.(samples);
  };

  const canUseWorklet =
    Boolean(audioCtx.audioWorklet?.addModule) && typeof globalThis.AudioWorkletNode !== 'undefined';

  if (canUseWorklet) {
    try {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      workletNode = new globalThis.AudioWorkletNode(audioCtx, 'tinyasr-resample-processor');
      workletNode.port.onmessage = (event) => {
        const samples = event.data instanceof Float32Array ? event.data : new Float32Array(event.data);
        emitChunk(samples);
      };
      source.connect(workletNode);
      logger.info('Resampler pipeline active', {
        mode: 'worklet',
        inputRate,
        outputRate: TARGET_SAMPLE_RATE,
        chunkSize,
      });
    } catch (err) {
      logger.warn('AudioWorklet unavailable, falling back to ScriptProcessorNode', { err });
      workletNode = null;
    }
  }

  if (!workletNode) {
    const pushSamples = createResampler(inputRate, chunkSize, emitChunk);
    scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
    scriptNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      onPeakSample?.(computePeak(input));
      pushSamples(input);
    };
    muteGain = audioCtx.createGain();
    muteGain.gain.value = 0;
    source.connect(scriptNode);
    scriptNode.connect(muteGain);
    muteGain.connect(audioCtx.destination);
    logger.info('Resampler pipeline active', {
      mode: 'script_processor',
      inputRate,
      outputRate: TARGET_SAMPLE_RATE,
      chunkSize,
    });
  }

  const teardown = () => {
    try {
      workletNode?.disconnect();
      scriptNode?.disconnect();
      muteGain?.disconnect();
      source.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    if (workletUrl) {
      URL.revokeObjectURL(workletUrl);
    }
    stream.getTracks().forEach((track) => track.stop());
    if (audioCtx.state !== 'closed') {
      audioCtx.close();
    }
  };

  return { teardown, audioContext: audioCtx, stream };
}

export async function startMicCapture({
  onChunk,
  onRms,
  chunkSize = CHUNK_SAMPLES,
  silentCheckMs = SILENT_MIC_CHECK_MS,
} = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Browser mediaDevices API unavailable');
  }

  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Web Audio API unavailable');
  }

  let stopped = false;
  let maxPeak = 0;
  let fallbackTriggered = false;

  let activePipeline = await openAudioPipeline({
    constraints: {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    },
    chunkSize,
    onChunk,
    onRms,
    onPeakSample: (peak) => {
      if (peak > maxPeak) maxPeak = peak;
    },
  });

  // Fallback to `{ audio: true }` if 2s of near-zero peak (< 0.001) indicates a muted/broken raw track
  const silentTimer = setTimeout(async () => {
    if (stopped || fallbackTriggered || maxPeak >= SILENT_MIC_PEAK_THRESHOLD) return;
    fallbackTriggered = true;
    logger.warn('Silent mic detected, retrying with default constraints', {
      maxPeak,
      silentCheckMs,
    });
    try {
      const nextPipeline = await openAudioPipeline({
        constraints: { audio: true },
        chunkSize,
        onChunk,
        onRms,
        onPeakSample: (peak) => {
          if (peak > maxPeak) maxPeak = peak;
        },
      });
      if (stopped) {
        nextPipeline.teardown();
        return;
      }
      activePipeline.teardown();
      activePipeline = nextPipeline;
    } catch (err) {
      logger.warn('Fallback mic pipeline failed, keeping original pipeline', { err });
    }
  }, silentCheckMs);

  const stop = () => {
    stopped = true;
    clearTimeout(silentTimer);
    activePipeline.teardown();
    logger.info('Mic capture stopped');
  };

  return {
    stop,
    get audioContext() {
      return activePipeline.audioContext;
    },
    get stream() {
      return activePipeline.stream;
    },
  };
}
