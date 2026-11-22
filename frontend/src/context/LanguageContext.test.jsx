import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { translations } from '../i18n/translations.js';
import { LanguageProvider, useTranslation } from './LanguageContext.jsx';

function collectKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([key, val]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return collectKeys(val, full);
    }
    return [full];
  });
}

function LangProbe() {
  const { lang, setLang, t } = useTranslation();
  return (
    <div>
      <span data-testid="active-lang">{lang}</span>
      <span data-testid="hero-cta">{t('landing.ctaPrimary')}</span>
      <span data-testid="fallback-val">{t('nonexistent.key', 'Custom Fallback')}</span>
      <span data-testid="key-val">{t('nonexistent.key')}</span>
      <button type="button" onClick={() => setLang('uk')}>
        UA
      </button>
      <button type="button" onClick={() => setLang('en')}>
        EN
      </button>
    </div>
  );
}

describe('LanguageContext & translations', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('throws when useTranslation is called outside LanguageProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<LangProbe />)).toThrow(
      'useTranslation must be used within a LanguageProvider'
    );
    spy.mockRestore();
  });

  it('has symmetric keys across en and uk dictionaries', () => {
    const enKeys = collectKeys(translations.en).sort();
    const ukKeys = collectKeys(translations.uk).sort();
    expect(enKeys).toEqual(ukKeys);
  });

  it('defaults to en, loads saved uk, falls back gracefully, and ignores storage errors', () => {
    render(
      <LanguageProvider>
        <LangProbe />
      </LanguageProvider>
    );

    expect(screen.getByTestId('active-lang').textContent).toBe('en');
    expect(screen.getByTestId('fallback-val').textContent).toBe('Custom Fallback');
    expect(screen.getByTestId('key-val').textContent).toBe('nonexistent.key');

    fireEvent.click(screen.getByRole('button', { name: 'UA' }));
    expect(screen.getByTestId('active-lang').textContent).toBe('uk');
    expect(localStorage.getItem('pt_lang')).toBe('uk');
    expect(document.documentElement.lang).toBe('uk');

    // Mounting a fresh LanguageProvider reads 'uk' from localStorage
    render(
      <LanguageProvider>
        <LangProbe />
      </LanguageProvider>
    );
    expect(screen.getAllByTestId('active-lang')[1].textContent).toBe('uk');

    // Verify storage error resilience on mount and setLang
    const origStorage = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        },
        clear: () => {},
      },
      configurable: true,
    });

    render(
      <LanguageProvider>
        <LangProbe />
      </LanguageProvider>
    );
    const buttons = screen.getAllByRole('button', { name: 'EN' });
    fireEvent.click(buttons[buttons.length - 1]);

    Object.defineProperty(window, 'localStorage', {
      value: origStorage,
      configurable: true,
    });
  });
});
