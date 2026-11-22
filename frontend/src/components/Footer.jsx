import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext.jsx';

export default function Footer() {
  const { lang } = useTranslation();

  return (
    <footer className="border-t border-white/[0.08] bg-[#07080A]/90 text-xs text-[#9CA3AF]">
      <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-3 px-4 py-6 sm:px-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#10B981]" />
          <span>
            {lang === 'uk'
              ? 'StagePulse · Клієнтська телеметрія мовлення · Ліцензія GPL-3.0'
              : 'StagePulse · Client-side speech telemetry · GPL-3.0 License'}
          </span>
        </div>
        <div className="font-mono text-[11px] text-[#9CA3AF]">
          {lang === 'uk' ? 'На базі ' : 'Powered by '}
          <a
            href="https://github.com/dkaraush/tinyasr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#F4F5F7] underline decoration-white/25 hover:text-[#FF6363]"
          >
            dkaraush/tinyasr
          </a>
        </div>
      </div>
    </footer>
  );
}
