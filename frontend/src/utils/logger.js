export const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEV_COLORS = {
  debug: 'color: #9CA3AF',
  info: 'color: #38BDF8',
  warn: 'color: #F59E0B; font-weight: 600',
  error: 'color: #EF4444; font-weight: 700',
};

function normalizeEnv(rawEnv, isDevDefault) {
  const val = String(rawEnv ?? '').trim().toLowerCase();
  if (val === 'prod' || val === 'production') return 'prod';
  if (val === 'dev' || val === 'development') return 'dev';
  return isDevDefault ? 'dev' : 'prod';
}

export function getLoggerConfig() {
  const metaEnv = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const env = normalizeEnv(metaEnv.VITE_APP_ENV, Boolean(metaEnv.DEV));
  const defaultLevel = env === 'dev' ? 'debug' : 'warn';
  const rawLevel = String(metaEnv.VITE_LOG_LEVEL ?? '').trim().toLowerCase();
  const level = Object.prototype.hasOwnProperty.call(LOG_LEVELS, rawLevel)
    ? rawLevel
    : defaultLevel;
  return {
    env,
    level,
    threshold: LOG_LEVELS[level],
  };
}

function serializeValue(val, seen) {
  if (val instanceof Error) {
    return {
      name: val.name,
      message: val.message,
      stack: val.stack,
    };
  }
  if (typeof val === 'bigint') {
    return val.toString();
  }
  if (val && typeof val === 'object') {
    if (seen.has(val)) return '[Circular]';
    seen.add(val);
    if (Array.isArray(val)) {
      return val.map((item) => serializeValue(item, seen));
    }
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = serializeValue(v, seen);
    }
    return out;
  }
  return val;
}

function serializeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  return serializeValue(meta, new WeakSet());
}

/**
 * Create a structured logger safe for both main thread (`window`) and Web Workers (`self`).
 * @param {string} tag Component or worker tag, e.g. 'ASR:Worker', 'Audio:Mic', 'ASR:Adapter'
 */
export function createLogger(tag) {
  const cleanTag = String(tag || 'App').replace(/^\[|\]$/g, '');

  const emit = (level, msg, meta) => {
    const { env, threshold } = getLoggerConfig();
    if (LOG_LEVELS[level] < threshold) return;

    const ts = new Date().toISOString();
    const safeMeta = serializeMeta(meta);

    if (env === 'prod') {
      const payload = JSON.stringify({
        ts,
        level,
        logger: cleanTag,
        msg,
        ...safeMeta,
      });
      const sink =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log;
      sink(payload);
      return;
    }

    const header = `%c${ts} [${level.toUpperCase()}] [${cleanTag}] ${msg}`;
    const style = DEV_COLORS[level];
    const sink = console[level] || console.log;
    if (Object.keys(safeMeta).length > 0) {
      sink(header, style, safeMeta);
    } else {
      sink(header, style);
    }
  };

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}
