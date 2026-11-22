// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, authApi, formatApiError } from '../api/client.js';
import { translations } from '../i18n/translations.js';

function makeT(lang = 'en') {
  return (key, fallback) => {
    const val = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), translations[lang]);
    return val !== undefined ? val : fallback ?? key;
  };
}

describe('API client & FastAPI error parser', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('authApi.register sends email and password only (no username)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        access_token: 'tok',
        token_type: 'bearer',
        user: { id: 1, email: 'user@example.com', is_pro: false, spin_count: 0, spins_remaining: 3 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await authApi.register({ email: 'user@example.com', password: 'secretpassword' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({ email: 'user@example.com', password: 'secretpassword' });
    expect(body).not.toHaveProperty('username');
  });

  it.each([
    {
      name: '422 invalid email in en',
      status: 422,
      payload: {
        detail: [
          {
            type: 'value_error',
            loc: ['body', 'email'],
            msg: 'value is not a valid email address: An email address must have an @-sign.',
          },
        ],
      },
      lang: 'en',
      expectedSubstr: /valid email/i,
    },
    {
      name: '422 short password in uk',
      status: 422,
      payload: {
        detail: [
          {
            type: 'string_too_short',
            loc: ['body', 'password'],
            msg: 'String should have at least 6 characters',
            ctx: { min_length: 6 },
          },
        ],
      },
      lang: 'uk',
      expectedSubstr: /6 символ/i,
    },
    {
      name: '401 invalid credentials in uk',
      status: 401,
      payload: { detail: 'Invalid email or password' },
      lang: 'uk',
      expectedSubstr: /Неправильна пошта або пароль/i,
    },
    {
      name: '400 email already registered in en',
      status: 400,
      payload: { detail: 'Email already registered' },
      lang: 'en',
      expectedSubstr: /already exists/i,
    },
  ])('parses and localizes $name', async ({ status, payload, lang, expectedSubstr }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        headers: { get: () => 'application/json' },
        json: async () => payload,
      })
    );

    let caught = null;
    try {
      await apiFetch('/api/auth/login', { method: 'POST', body: '{}' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeTruthy();
    expect(caught.status).toBe(status);
    const localized = formatApiError(caught, makeT(lang));
    expect(localized).toMatch(expectedSubstr);
  });
});
