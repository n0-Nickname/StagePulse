import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Ensure reliable localStorage in jsdom / Node 25
const createStorage = () => {
  let store = {};
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (idx) => Object.keys(store)[idx] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

if (typeof window !== 'undefined') {
  if (!window.localStorage || typeof window.localStorage.clear !== 'function') {
    const mockStorage = createStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
    });
  }

  // Mock AudioContext & webkitAudioContext
  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
    }
    createMediaStreamSource() {
      return { connect: vi.fn() };
    }
    createAnalyser() {
      return {
        fftSize: 512,
        frequencyBinCount: 256,
        smoothingTimeConstant: 0.75,
        getFloatTimeDomainData: vi.fn((arr) => arr.fill(0.05)),
        getByteFrequencyData: vi.fn((arr) => arr.fill(100)),
      };
    }
  }

  if (!window.AudioContext) {
    window.AudioContext = MockAudioContext;
  }
  if (!window.webkitAudioContext) {
    window.webkitAudioContext = MockAudioContext;
  }

  // Mock navigator.mediaDevices.getUserMedia
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
      configurable: true,
    });
  } else if (!navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
  }

  // Mock caches / CacheStorage
  if (typeof globalThis.caches === 'undefined') {
    const cacheMap = new Map();
    const mockCacheStorage = {
      open: vi.fn(async (name) => {
        if (!cacheMap.has(name)) {
          const entries = new Map();
          cacheMap.set(name, {
            match: vi.fn(async (k) => entries.get(k)),
            put: vi.fn(async (k, v) => entries.set(k, v)),
            delete: vi.fn(async (k) => entries.delete(k)),
          });
        }
        return cacheMap.get(name);
      }),
      has: vi.fn(async (name) => cacheMap.has(name)),
      delete: vi.fn(async (name) => cacheMap.delete(name)),
      keys: vi.fn(async () => Array.from(cacheMap.keys())),
      match: vi.fn(async () => undefined),
    };
    Object.defineProperty(globalThis, 'caches', {
      value: mockCacheStorage,
      configurable: true,
    });
  }

  // Mock HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
  }));

  // Mock requestAnimationFrame / cancelAnimationFrame safely
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  }
}
