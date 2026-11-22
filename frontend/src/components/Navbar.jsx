import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Mic, BarChart3, Crown, Sparkles, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from '../context/LanguageContext.jsx';

export default function Navbar() {
  const { user, logout, openSlotModal } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const location = useLocation();

  if (!user) {
    return null;
  }

  const isPractice = location.pathname === '/';
  const isDashboard = location.pathname === '/dashboard';

  return (
    <header className="sticky top-0 z-40 border-b border-[#3A3834] bg-[#1E1D1B]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-[#EAE6DF] transition-opacity hover:opacity-80 cursor-pointer"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#D97757]/15 border border-[#D97757]/30 text-[#D97757]">
              <Mic className="h-5 w-5" />
            </div>
            <span className="font-editorial text-xl font-semibold tracking-tight text-[#EAE6DF]">
              Stage<span className="text-[#D97757]">Pulse</span>
            </span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1 rounded-xl bg-[#2A2926] p-1 border border-[#3A3834]">
            <Link
              to="/"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                isPractice
                  ? 'bg-[#1E1D1B] text-[#EAE6DF] shadow-sm border border-[#3A3834]'
                  : 'text-[#9E9A92] hover:text-[#EAE6DF]'
              }`}
            >
              <Mic className="h-4 w-4" />
              {t('nav.practice')}
            </Link>
            <Link
              to="/dashboard"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                isDashboard
                  ? 'bg-[#1E1D1B] text-[#EAE6DF] shadow-sm border border-[#3A3834]'
                  : 'text-[#9E9A92] hover:text-[#EAE6DF]'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              {t('nav.dashboard')}
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* UA | EN Language Toggle Pill */}
          <div
            className="inline-flex items-center rounded-lg border border-[#3A3834] bg-[#2A2926] p-0.5 text-[11px] font-semibold"
            role="group"
            aria-label="Language"
          >
            <button
              type="button"
              onClick={() => setLang('uk')}
              className={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
                lang === 'uk'
                  ? 'bg-[#D97757] text-white'
                  : 'text-[#9E9A92] hover:text-[#EAE6DF]'
              }`}
            >
              UA
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`rounded-md px-2 py-1 transition-colors cursor-pointer ${
                lang === 'en'
                  ? 'bg-[#D97757] text-white'
                  : 'text-[#9E9A92] hover:text-[#EAE6DF]'
              }`}
            >
              EN
            </button>
          </div>

          {user.is_pro ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#4A8B6F]/15 border border-[#4A8B6F]/30 px-3 py-1 text-xs font-semibold text-[#4A8B6F]">
              <Crown className="h-3.5 w-3.5" />
              {t('nav.proBadge')}
            </span>
          ) : (
            <button
              type="button"
              onClick={openSlotModal}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#D97757] hover:bg-[#C46647] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('nav.unlockPro')}
            </button>
          )}

          <div className="hidden md:flex items-center gap-2 border-l border-[#3A3834] pl-3">
            <span className="text-sm font-medium text-[#9E9A92]">
              {user.username}
            </span>
          </div>

          <button
            type="button"
            onClick={logout}
            title={t('nav.signOut')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#3A3834] bg-[#2A2926] px-2.5 py-1.5 text-xs font-medium text-[#9E9A92] transition-colors hover:bg-[#3A3834]/50 hover:text-[#EAE6DF] cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('nav.signOut')}</span>
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      <div className="flex sm:hidden border-t border-[#3A3834] bg-[#1E1D1B] px-4 py-2 gap-2">
        <Link
          to="/"
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium cursor-pointer ${
            isPractice
              ? 'bg-[#2A2926] text-[#EAE6DF] border border-[#3A3834] shadow-sm'
              : 'text-[#9E9A92]'
          }`}
        >
          <Mic className="h-3.5 w-3.5" />
          {t('nav.practice')}
        </Link>
        <Link
          to="/dashboard"
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium cursor-pointer ${
            isDashboard
              ? 'bg-[#2A2926] text-[#EAE6DF] border border-[#3A3834] shadow-sm'
              : 'text-[#9E9A92]'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t('nav.dashboard')}
        </Link>
      </div>
    </header>
  );
}
