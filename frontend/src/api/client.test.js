import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiFetch,
  authApi,
  slotsApi,
  presentationsApi,
  formatApiError,
} from './client.js';
import { translations } from '../i18n/translations.js';

function makeT(lang = 'en') {
  return (key, fallback) => {
    const val = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), translations[lang]);
    return val !== undefined ? val : fallback ?? key;
  };
}

describe('api/client.js', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes paths, attaches Bearer token, and parses JSON responses', async () => {
    localStorage.setItem('pt_token', 'jwt-token-123');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ id: 1, email: 'a@b.com' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await apiFetch('auth/me');
    expect(res).toEqual({ id: 1, email: 'a@b.com' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer jwt-token-123',
        }),
      })
    );
  });

  it('handles malformed JSON, non-JSON text responses, and empty responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => {
            throw new Error('bad json');
          },
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          headers: { get: () => 'text/plain' },
          text: async () => 'Bad Gateway',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: { get: () => '' },
          text: async () => '',
        })
    );

    const r1 = await apiFetch('/api/ping');
    expect(r1).toBeNull();

    await expect(apiFetch('/ping')).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
    });

    await expect(apiFetch('/ping')).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (500)',
    });
  });

  it('handles data.message and fallback non-body loc items on error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({ message: 'Custom message error' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          headers: { get: () => 'application/json' },
          json: async () => ({
            detail: [{ type: 'custom', loc: 'invalid-loc' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({ other: 'unknown' }),
        })
    );

    await expect(apiFetch('/err1')).rejects.toMatchObject({ message: 'Custom message error' });
    await expect(apiFetch('/err2')).rejects.toMatchObject({ status: 422 });
    await expect(apiFetch('/err3')).rejects.toMatchObject({ message: 'Request failed (400)' });
  });

  it('exposes authApi, slotsApi, and presentationsApi endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await authApi.register({ email: 'u@test.com', password: 'password1' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'u@test.com',
      password: 'password1',
    });

    await authApi.login({ email: 'u@test.com', password: 'password1' });
    await authApi.me();
    await slotsApi.spin();
    await presentationsApi.create({ title: 'Talk' });
    await presentationsApi.list();

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('formatApiError localizes all 422, 400, 401, network, and fallback error variants', () => {
    const tEn = makeT('en');
    const tUk = makeT('uk');

    expect(formatApiError(null, tEn)).toBe(translations.en.auth.authFailed);

    const err422Email = {
      status: 422,
      data: {
        detail: [{ type: 'value_error', loc: ['body', 'email'], msg: 'Invalid email' }],
      },
    };
    expect(formatApiError(err422Email, tUk)).toBe(translations.uk.auth.errors.invalidEmail);

    const err422PwdShort = {
      status: 422,
      validationErrors: [{ field: 'password', type: 'string_too_short', msg: 'too short' }],
    };
    expect(formatApiError(err422PwdShort, tEn)).toBe(translations.en.auth.errors.passwordTooShort);

    const err422PwdReq = {
      status: 422,
      validationErrors: [{ field: 'password', type: 'missing', msg: 'Field required' }],
    };
    expect(formatApiError(err422PwdReq, tEn)).toBe(translations.en.auth.errors.passwordRequired);

    const err422Other = {
      status: 422,
      validationErrors: [
        { field: 'title', type: 'value_error', msg: 'bad title' },
        { field: '', type: 'value_error', msg: 'root error' },
      ],
    };
    expect(formatApiError(err422Other, tEn)).toBe('title: bad title root error');

    expect(formatApiError({ status: 422, data: { detail: 'unparseable' } }, tEn)).toBe(
      translations.en.auth.errors.validationGeneric
    );
    expect(formatApiError({ status: 400, data: { detail: 'Email already registered' } }, tEn)).toBe(
      translations.en.auth.errors.emailAlreadyRegistered
    );
    expect(formatApiError({ status: 401, data: { detail: 'Invalid email or password' } }, tUk)).toBe(
      translations.uk.auth.errors.invalidCredentials
    );
    expect(formatApiError({ status: 400, data: { detail: 'Inactive user' } }, tEn)).toBe(
      translations.en.auth.errors.inactiveUser
    );
    expect(formatApiError({ status: 400, data: { detail: 'No spins remaining' } }, tEn)).toBe(
      translations.en.slots.noSpinsLeft
    );
    expect(formatApiError({ status: 401, data: { detail: 'Not authenticated' } }, tEn)).toBe(
      translations.en.auth.errors.unauthorized
    );

    const netErr = new TypeError('Failed to fetch');
    expect(formatApiError(netErr, tEn)).toBe(translations.en.auth.errors.networkError);

    expect(formatApiError({ status: 500, message: 'Server boom' }, tEn)).toBe('Server boom');
    expect(formatApiError({ status: 500, message: '' }, tEn)).toBe(translations.en.auth.authFailed);
  });
});
