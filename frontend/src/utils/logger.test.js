import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, getLoggerConfig, LOG_LEVELS } from './logger.js';

describe('utils/logger.js', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves VITE_APP_ENV and VITE_LOG_LEVEL with dev/prod defaults', () => {
    expect(LOG_LEVELS).toEqual({ debug: 0, info: 1, warn: 2, error: 3 });

    // Default in vitest (DEV=true) -> dev / debug
    const def = getLoggerConfig();
    expect(def).toEqual({ env: 'dev', level: 'debug', threshold: 0 });

    vi.stubEnv('VITE_APP_ENV', 'prod');
    expect(getLoggerConfig()).toEqual({ env: 'prod', level: 'warn', threshold: 2 });

    vi.stubEnv('VITE_LOG_LEVEL', 'info');
    expect(getLoggerConfig()).toEqual({ env: 'prod', level: 'info', threshold: 1 });

    vi.stubEnv('VITE_APP_ENV', 'development');
    vi.stubEnv('VITE_LOG_LEVEL', 'invalid_level');
    expect(getLoggerConfig()).toEqual({ env: 'dev', level: 'debug', threshold: 0 });

    vi.stubEnv('VITE_APP_ENV', 'production');
    vi.stubEnv('VITE_LOG_LEVEL', 'error');
    expect(getLoggerConfig()).toEqual({ env: 'prod', level: 'error', threshold: 3 });

    // Explicit fallback when DEV is false and VITE_APP_ENV is unset
    vi.stubEnv('VITE_APP_ENV', '');
    vi.stubEnv('VITE_LOG_LEVEL', '');
    vi.stubEnv('DEV', false);
    expect(getLoggerConfig()).toEqual({ env: 'prod', level: 'warn', threshold: 2 });
  });

  it('emits color-coded human-readable console logs in dev mode with tag, timestamp, level, and meta', () => {
    vi.stubEnv('VITE_APP_ENV', 'dev');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = createLogger('[ASR:Worker]');
    log.debug('chunk pushed', { len: 640 });
    log.info('ready');
    log.warn('cache evicted', { url: '/models/a.gz' });
    log.error('init failed', { err: new Error('boom') });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0][0]).toMatch(
      /^%c\d{4}-\d{2}-\d{2}T.* \[DEBUG\] \[ASR:Worker\] chunk pushed$/
    );
    expect(debugSpy.mock.calls[0][1]).toContain('color:');
    expect(debugSpy.mock.calls[0][2]).toEqual({ len: 640 });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]).toHaveLength(2); // no empty meta arg

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[WARN] [ASR:Worker] cache evicted');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][2].err).toMatchObject({ name: 'Error', message: 'boom' });
  });

  it('emits single-line JSON in prod mode, filters below VITE_LOG_LEVEL, and handles circular/BigInt meta', () => {
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'info');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = createLogger('Audio:Mic');
    log.debug('should be filtered', { a: 1 });
    expect(logSpy).not.toHaveBeenCalled();

    log.info('AudioContext opened', { sampleRate: 48000 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsedInfo = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsedInfo).toMatchObject({
      level: 'info',
      logger: 'Audio:Mic',
      msg: 'AudioContext opened',
      sampleRate: 48000,
    });
    expect(typeof parsedInfo.ts).toBe('string');

    const circular = { label: 'self' };
    circular.self = circular;
    log.warn('circular meta', { circular, count: 42n, tags: ['a', new Error('nested')] });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const parsedWarn = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(parsedWarn.level).toBe('warn');
    expect(parsedWarn.logger).toBe('Audio:Mic');
    expect(parsedWarn.count).toBe('42');

    log.error('ENGINE_ERROR', { err: new Error('WASM link error') });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsedErr = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(parsedErr).toMatchObject({
      level: 'error',
      logger: 'Audio:Mic',
      msg: 'ENGINE_ERROR',
      err: { name: 'Error', message: 'WASM link error' },
    });
  });

  it('works cleanly in Web Worker environments where window is undefined', () => {
    const origWindow = globalThis.window;
    // Simulate worker global scope without window
    vi.stubGlobal('window', undefined);
    vi.stubEnv('VITE_APP_ENV', 'prod');
    vi.stubEnv('VITE_LOG_LEVEL', 'debug');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const workerLog = createLogger('ASR:Adapter');
    workerLog.debug('worker context ok', { worker: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0])).toMatchObject({
      level: 'debug',
      logger: 'ASR:Adapter',
      msg: 'worker context ok',
      worker: true,
    });

    vi.stubGlobal('window', origWindow);
  });
});
