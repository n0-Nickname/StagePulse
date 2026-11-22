import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthPage from './AuthPage.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    login: mockLogin,
    register: mockRegister,
    user: null,
    loading: false,
  }),
}));

function renderAuth(initialEntry = '/auth?mode=login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LanguageProvider>
        <AuthPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('AuthPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('enforces email and password only (no username) and switches between login and register tabs', () => {
    renderAuth('/auth?mode=register');

    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Username/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Log in/i }));
    expect(screen.getByRole('tab', { name: /Log in/i })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: /Sign up/i }));
    expect(screen.getByRole('tab', { name: /Sign up/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('displays localized inline crimson alert banner for 422 and 401 errors', async () => {
    const err422 = new Error('password too short');
    err422.status = 422;
    err422.data = {
      detail: [
        {
          type: 'string_too_short',
          loc: ['body', 'password'],
          msg: 'String should have at least 6 characters',
        },
      ],
    };
    mockRegister.mockRejectedValueOnce(err422);

    renderAuth('/auth?mode=register');

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: '123' } });
    fireEvent.submit(screen.getByRole('button', { name: /Create account/i }).closest('form'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/6 characters/i);
  });

  it('submits login and register successfully and navigates to /practice', async () => {
    mockLogin.mockResolvedValueOnce({ access_token: 'jwt' });
    mockRegister.mockResolvedValueOnce({ access_token: 'jwt2' });

    renderAuth('/auth?mode=login');

    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'speaker@example.com' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /Log in/i }).closest('form'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'speaker@example.com',
        password: 'password123',
      });
      expect(mockNavigate).toHaveBeenCalledWith('/practice');
    });

    fireEvent.click(screen.getByRole('tab', { name: /Sign up/i }));
    fireEvent.submit(screen.getByRole('button', { name: /Create account/i }).closest('form'));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        email: 'speaker@example.com',
        password: 'password123',
      });
    });
  });
});
