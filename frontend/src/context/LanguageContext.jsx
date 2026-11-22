import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { translations } from '../i18n/translations.js';

const LanguageContext = createContext(null);
const STORAGE_KEY = 'pt_lang';

function resolvePath(obj, path) {
  return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'en' || saved === 'uk' ? saved : 'uk';
    } catch {
      return 'uk';
    }
  });

  const setLang = useCallback((nextLang) => {
    const normalized = nextLang === 'en' ? 'en' : 'uk';
    setLangState(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const t = useCallback(
    (key, fallback) => {
      const dict = translations[lang] || translations.uk;
      const value = resolvePath(dict, key);
      if (value !== undefined) return value;
      const enValue = resolvePath(translations.en, key);
      if (enValue !== undefined) return enValue;
      return fallback !== undefined ? fallback : key;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return ctx;
}
