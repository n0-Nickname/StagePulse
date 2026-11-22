import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Footer from './Footer.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

describe('Footer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders GPL-3.0 and dkaraush/tinyasr attribution in English and Ukrainian', () => {
    const { unmount } = render(
      <LanguageProvider>
        <Footer />
      </LanguageProvider>
    );

    expect(screen.getByText(/GPL-3\.0 License/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /dkaraush\/tinyasr/i });
    expect(link).toHaveAttribute('href', 'https://github.com/dkaraush/tinyasr');
    unmount();

    localStorage.setItem('pt_lang', 'uk');
    render(
      <LanguageProvider>
        <Footer />
      </LanguageProvider>
    );
    expect(screen.getByText(/Ліцензія GPL-3\.0/i)).toBeInTheDocument();
  });
});
