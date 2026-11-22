export const TARGET_SAMPLE_RATE = 16000;
export const CHUNK_SAMPLES = 1600;

export function computeRms(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const val = samples[i];
    sum += val * val;
  }
  return Math.sqrt(sum / samples.length);
}

export function createSampleChunker(chunkSize, onChunk, onRms) {
  let buffer = new Float32Array(chunkSize);
  let offset = 0;

  return (input) => {
    for (let i = 0; i < input.length; i += 1) {
      buffer[offset] = input[i];
      offset += 1;
      if (offset === chunkSize) {
        const readyChunk = buffer;
        buffer = new Float32Array(chunkSize);
        offset = 0;
        onRms?.(computeRms(readyChunk));
        onChunk?.(readyChunk);
      }
    }
  };
}

const WORKLET_CODE = `
class TinyAsrCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(1600);
    this._offset = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i += 1) {
      this._buffer[this._offset++] = channel[i];
      if (this._offset === 1600) {
        const chunk = this._buffer;
        this._buffer = new Float32Array(1600);
        this._offset = 0;
        this.port.postMessage(chunk, [chunk.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('tinyasr-capture-processor', TinyAsrCaptureProcessor);
`;

export async function startMicCapture({
  onChunk,
  onRms,
  sampleRate = TARGET_SAMPLE_RATE,
  chunkSize = CHUNK_SAMPLES,
} = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Browser mediaDevices API unavailable');
  }

  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Web Audio API unavailable');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const audioCtx = new AudioContextCtor({ sampleRate });
  const source = audioCtx.createMediaStreamSource(stream);
  let workletNode = null;
  let scriptNode = null;
  let muteGain = null;
  let workletUrl = null;

  const canUseWorklet =
    Boolean(audioCtx.audioWorklet?.addModule) && typeof globalThis.AudioWorkletNode !== 'undefined';

  if (canUseWorklet) {
    try {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      workletNode = new globalThis.AudioWorkletNode(audioCtx, 'tinyasr-capture-processor');
      workletNode.port.onmessage = (event) => {
        const samples = event.data instanceof Float32Array ? event.data : new Float32Array(event.data);
        onRms?.(computeRms(samples));
        onChunk?.(samples);
      };
      source.connect(workletNode);
    } catch {
      workletNode = null;
    }
  }

  if (!workletNode) {
    const pushSamples = createSampleChunker(chunkSize, onChunk, onRms);
    scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
    scriptNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      pushSamples(input);
    };
    muteGain = audioCtx.createGain();
    muteGain.gain.value = 0;
    source.connect(scriptNode);
    scriptNode.connect(muteGain);
    muteGain.connect(audioCtx.destination);
  }

  const stop = () => {
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

  return {
    stop,
    audioContext: audioCtx,
    stream,
  };
}
