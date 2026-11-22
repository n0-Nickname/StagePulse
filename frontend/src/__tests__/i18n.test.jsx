// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { translations } from '../i18n/translations.js';
import { LanguageProvider, useTranslation } from '../context/LanguageContext.jsx';

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
      <button type="button" onClick={() => setLang('uk')}>
        UA
      </button>
      <button type="button" onClick={() => setLang('en')}>
        EN
      </button>
    </div>
  );
}

describe('i18n translations & LanguageProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('has symmetric keys across en and uk dictionaries including landing and error keys', () => {
    const enKeys = collectKeys(translations.en).sort();
    const ukKeys = collectKeys(translations.uk).sort();
    expect(enKeys).toEqual(ukKeys);
    expect(enKeys).toContain('landing.heroTitle');
    expect(enKeys).toContain('landing.bento1Title');
    expect(enKeys).toContain('auth.errors.invalidCredentials');
    expect(enKeys).toContain('practice.wasmReady');
  });

  it('defaults to en and switches cleanly between en and uk with localStorage persistence', () => {
    render(
      <LanguageProvider>
        <LangProbe />
      </LanguageProvider>
    );

    expect(screen.getByTestId('active-lang').textContent).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByTestId('hero-cta').textContent).toBe(translations.en.landing.ctaPrimary);

    fireEvent.click(screen.getByRole('button', { name: 'UA' }));
    expect(screen.getByTestId('active-lang').textContent).toBe('uk');
    expect(localStorage.getItem('pt_lang')).toBe('uk');
    expect(document.documentElement.lang).toBe('uk');
    expect(screen.getByTestId('hero-cta').textContent).toBe(translations.uk.landing.ctaPrimary);
  });
});
