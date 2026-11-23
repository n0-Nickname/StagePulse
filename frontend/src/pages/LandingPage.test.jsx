import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from './LandingPage.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

const authState = {
  user: null,
  loading: false,
};

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

function renderLanding() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <LandingPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('LandingPage', () => {
  beforeEach(() => {
    localStorage.clear();
    authState.user = null;
  });

  it('renders semantic landmarks, Rust/WASM hero, 4 Bento cards with mouse spotlight, and guest CTAs', () => {
    renderLanding();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    expect(screen.getByText(/32MB Client-Side Rust\/WASM Neural Speech Engine/i)).toBeInTheDocument();
    const firstCard = screen.getByText(/Local Rust\/WASM Neural STT/i).closest('article');
    fireEvent.mouseMove(firstCard, { clientX: 120, clientY: 60 });
    expect(firstCard.style.getPropertyValue('--mouse-x')).toBeTruthy();

    expect(screen.getByText(/Timestamp-Accurate Pause Detection/i)).toBeInTheDocument();
    expect(screen.getByText(/Filler Word & Pacing Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/PRO Pace Mastery Milestones/i)).toBeInTheDocument();

    const startCta = screen.getByRole('link', { name: /Start Practicing/i });
    expect(startCta).toHaveAttribute('href', '/auth?mode=register');

    const loginLinks = screen.getAllByRole('link', { name: /Log In/i });
    expect(loginLinks[0]).toHaveAttribute('href', '/auth?mode=login');
  });

  it('links authenticated users to /practice and /dashboard', () => {
    authState.user = { id: 1, email: 'speaker@stagepulse.dev', is_pro: false };
    renderLanding();

    expect(screen.getByRole('link', { name: /Start Practicing/i })).toHaveAttribute(
      'href',
      '/practice'
    );
    expect(screen.getByRole('link', { name: /Open Dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });

  it('switches copy to Ukrainian via UA | EN pill', () => {
    renderLanding();
    fireEvent.click(screen.getByRole('button', { name: 'UA' }));
    expect(screen.getByRole('link', { name: /Почати репетицію/i })).toBeInTheDocument();
  });
});
