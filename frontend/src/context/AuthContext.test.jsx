import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { authApi } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  authApi: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
  },
}));

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="email">{auth.user?.email || 'none'}</span>
      <span data-testid="pro">{String(Boolean(auth.user?.is_pro))}</span>
      <span data-testid="slot-open">{String(auth.isSlotModalOpen)}</span>
      <button type="button" onClick={auth.openSlotModal}>
        open-slot
      </button>
      <button type="button" onClick={auth.closeSlotModal}>
        close-slot
      </button>
      <button
        type="button"
        onClick={() => auth.updateUser((prev) => ({ ...prev, is_pro: true }))}
      >
        update-fn
      </button>
      <button type="button" onClick={() => auth.updateUser({ is_pro: false })}>
        update-obj
      </button>
      <button
        type="button"
        onClick={() => auth.login({ email: 'a@b.com', password: 'secret' })}
      >
        do-login
      </button>
      <button
        type="button"
        onClick={() => auth.register({ email: 'new@b.com', password: 'secret' })}
      >
        do-register
      </button>
      <button type="button" onClick={auth.logout}>
        do-logout
      </button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('throws when useAuth is called outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AuthProbe />)).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });

  it('resolves unauthenticated state immediately when no token exists', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('email').textContent).toBe('none');
  });

  it('loads user on mount when token exists and clears token on 401/403', async () => {
    localStorage.setItem('pt_token', 'valid-tok');
    authApi.me.mockResolvedValueOnce({ id: 1, email: 'me@test.com', is_pro: false });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('email').textContent).toBe('me@test.com'));

    // Test updateUser (function and object), slot modal toggle
    await act(async () => {
      screen.getByText('open-slot').click();
    });
    expect(screen.getByTestId('slot-open').textContent).toBe('true');

    await act(async () => {
      screen.getByText('close-slot').click();
      screen.getByText('update-fn').click();
    });
    expect(screen.getByTestId('slot-open').textContent).toBe('false');
    expect(screen.getByTestId('pro').textContent).toBe('true');

    await act(async () => {
      screen.getByText('update-obj').click();
    });
    expect(screen.getByTestId('pro').textContent).toBe('false');

    // Logout clears state & token
    await act(async () => {
      screen.getByText('do-logout').click();
    });
    expect(screen.getByTestId('email').textContent).toBe('none');
    expect(localStorage.getItem('pt_token')).toBeNull();
  });

  it('clears token on 401/403 from me() and keeps state on non-auth error', async () => {
    localStorage.setItem('pt_token', 'expired-tok');
    authApi.me.mockRejectedValueOnce({ status: 401 });

    const { unmount } = render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(localStorage.getItem('pt_token')).toBeNull();
    unmount();

    localStorage.setItem('pt_token', 'keep-tok');
    authApi.me.mockRejectedValueOnce({ status: 500 });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(localStorage.getItem('pt_token')).toBe('keep-tok');
  });

  it('login and register persist token and handle both inline user and refreshUser fallback', async () => {
    authApi.login
      .mockResolvedValueOnce({
        access_token: 'tok-login',
        user: { id: 2, email: 'login@test.com', is_pro: false },
      })
      .mockResolvedValueOnce({ access_token: 'tok-login-2' });
    authApi.me.mockResolvedValue({ id: 3, email: 'refreshed@test.com', is_pro: true });
    authApi.register
      .mockResolvedValueOnce({
        access_token: 'tok-reg',
        user: { id: 4, email: 'reg@test.com', is_pro: false },
      })
      .mockResolvedValueOnce({ access_token: 'tok-reg-2' });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('do-login').click();
    });
    expect(screen.getByTestId('email').textContent).toBe('login@test.com');

    await act(async () => {
      screen.getByText('do-login').click();
    });
    expect(screen.getByTestId('email').textContent).toBe('refreshed@test.com');

    await act(async () => {
      screen.getByText('do-register').click();
    });
    expect(screen.getByTestId('email').textContent).toBe('reg@test.com');

    await act(async () => {
      screen.getByText('do-register').click();
    });
    expect(screen.getByTestId('email').textContent).toBe('refreshed@test.com');

    // Also cover updateUser(obj) when prev is null
    await act(async () => {
      screen.getByText('do-logout').click();
    });
    await act(async () => {
      screen.getByText('update-obj').click();
    });
  });
});
