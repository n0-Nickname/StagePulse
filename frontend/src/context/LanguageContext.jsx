import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
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
      return saved === 'en' || saved === 'uk' ? saved : 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((nextLang) => {
    const normalized = nextLang === 'uk' ? 'uk' : 'en';
    setLangState(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const t = useCallback(
    (key, fallback) => {
      const value = resolvePath(translations[lang], key);
      if (value !== undefined) return value;
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
