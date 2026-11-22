import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined') {
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
}
