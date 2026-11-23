import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Mic, BarChart3, Crown, Sparkles, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from '../context/LanguageContext.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';

export default function Navbar() {
  const { user, logout, openSlotModal } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  if (!user || location.pathname === '/' || location.pathname === '/auth') {
    return null;
  }

  const isPractice = location.pathname === '/practice';
  const isDashboard = location.pathname === '/dashboard';

  return (
    <header className="sticky top-0 z-40 overflow-x-hidden border-b border-white/[0.08] bg-[#07080A]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-3">
        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
          <Link
            to="/"
            className="flex items-center gap-2 sm:gap-2.5 shrink-0 text-[#F4F5F7] transition-opacity hover:opacity-85 cursor-pointer"
          >
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-[#FF6363]/15 border border-[#FF6363]/35 text-[#FF6363] shadow-[0_0_16px_rgba(255,99,99,0.22)]">
              <Mic className="h-4 w-4" />
            </div>
            <span className="text-base sm:text-lg font-semibold tracking-tight text-[#F4F5F7]">
              Stage<span className="text-[#FF6363]">Pulse</span>
            </span>
          </Link>

          <nav
            aria-label="App navigation"
            className="hidden sm:flex items-center gap-1 rounded-xl obsidian-inset p-1"
          >
            <Link
              to="/practice"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                isPractice
                  ? 'bg-white/[0.08] text-[#F4F5F7] border border-white/[0.1]'
                  : 'text-[#9CA3AF] hover:text-[#F4F5F7]'
              }`}
            >
              <Mic className="h-3.5 w-3.5 text-[#FF6363]" />
              {t('nav.practice')}
            </Link>
            <Link
              to="/dashboard"
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                isDashboard
                  ? 'bg-white/[0.08] text-[#F4F5F7] border border-white/[0.1]'
                  : 'text-[#9CA3AF] hover:text-[#F4F5F7]'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5 text-[#8B5CF6]" />
              {t('nav.dashboard')}
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <LanguageSwitcher />

          {user.is_pro ? (
            <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-[#10B981]/15 border border-[#10B981]/35 px-2.5 sm:px-3 py-1 text-xs font-semibold text-[#10B981]">
              <Crown className="h-3.5 w-3.5" />
              {t('nav.proBadge')}
            </span>
          ) : (
            <button
              type="button"
              onClick={openSlotModal}
              className="crimson-glow-btn inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              {t('nav.unlockPro')}
            </button>
          )}

          <div className="hidden md:flex items-center gap-2 border-l border-white/[0.08] pl-3">
            <span className="text-xs font-mono text-[#9CA3AF] truncate max-w-[180px]">
              {user.email}
            </span>
          </div>

          <button
            type="button"
            onClick={logout}
            title={t('nav.signOut')}
            aria-label={t('nav.signOut')}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#121317]/80 px-2.5 py-1.5 text-xs font-medium text-[#9CA3AF] transition-colors hover:bg-white/[0.06] hover:text-[#F4F5F7] cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('nav.signOut')}</span>
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      <div className="flex sm:hidden border-t border-white/[0.08] bg-[#07080A] px-3 py-2 gap-2">
        <Link
          to="/practice"
          className={`flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium cursor-pointer ${
            isPractice
              ? 'bg-white/[0.08] text-[#F4F5F7] border border-white/[0.1]'
              : 'text-[#9CA3AF]'
          }`}
        >
          <Mic className="h-3.5 w-3.5 text-[#FF6363]" />
          {t('nav.practice')}
        </Link>
        <Link
          to="/dashboard"
          className={`flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium cursor-pointer ${
            isDashboard
              ? 'bg-white/[0.08] text-[#F4F5F7] border border-white/[0.1]'
              : 'text-[#9CA3AF]'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5 text-[#8B5CF6]" />
          {t('nav.dashboard')}
        </Link>
      </div>
    </header>
  );
}
