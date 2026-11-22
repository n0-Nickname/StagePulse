import React from 'react';
import { useTranslation } from '../context/LanguageContext.jsx';

export default function LanguageSwitcher({ className = '' }) {
  const { lang, setLang } = useTranslation();

  return (
    <div
      role="group"
      aria-label="Language"
      className={`inline-flex items-center rounded-lg border border-white/[0.08] bg-[#0B0C10]/90 p-0.5 text-[11px] font-mono font-semibold ${className}`}
    >
      <button
        type="button"
        onClick={() => setLang('uk')}
        aria-pressed={lang === 'uk'}
        className={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
          lang === 'uk'
            ? 'bg-[#FF6363] text-white shadow-[0_0_12px_rgba(255,99,99,0.4)]'
            : 'text-[#9CA3AF] hover:text-[#F4F5F7]'
        }`}
      >
        UA
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        className={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
          lang === 'en'
            ? 'bg-[#FF6363] text-white shadow-[0_0_12px_rgba(255,99,99,0.4)]'
            : 'text-[#9CA3AF] hover:text-[#F4F5F7]'
        }`}
      >
        EN
      </button>
    </div>
  );
}
