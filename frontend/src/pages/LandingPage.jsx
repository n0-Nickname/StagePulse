import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Mic,
  Cpu,
  Timer,
  Sparkles,
  Activity,
  ArrowRight,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from '../context/LanguageContext.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';

function BentoCard({ children, className = '', index = 0 }) {
  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.style.setProperty('--mouse-x', `${x}px`);
    e.currentTarget.style.setProperty('--mouse-y', `${y}px`);
  }, []);

  return (
    <article
      onMouseMove={handleMouseMove}
      style={{ '--stagger-index': index }}
      className={`bento-card stagger-item rounded-2xl p-6 sm:p-7 ${className}`}
    >
      {children}
    </article>
  );
}

export default function LandingPage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  const primaryCtaTo = user ? '/practice' : '/auth?mode=register';

  return (
    <div className="min-h-screen flex flex-col bg-[#07080A] text-[#F4F5F7]">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#07080A]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 text-[#F4F5F7] transition-opacity hover:opacity-90"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF6363]/15 border border-[#FF6363]/35 text-[#FF6363] shadow-[0_0_18px_rgba(255,99,99,0.22)]">
              <Mic className="h-4 w-4" />
            </div>
            <span className="text-lg font-semibold tracking-tight">
              Stage<span className="text-[#FF6363]">Pulse</span>
            </span>
          </Link>

          <nav aria-label="Primary navigation" className="flex items-center gap-2.5 sm:gap-3">
            <LanguageSwitcher />
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#121317]/80 px-3.5 py-1.5 text-xs font-medium text-[#9CA3AF] hover:text-[#F4F5F7] hover:border-white/[0.16] transition-colors"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  {t('nav.dashboard')}
                </Link>
                <Link
                  to="/practice"
                  className="crimson-glow-btn inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold"
                >
                  {t('nav.openStudio')}
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/auth?mode=login"
                  className="rounded-lg border border-white/[0.08] bg-[#121317]/80 px-3.5 py-1.5 text-xs font-medium text-[#F4F5F7] hover:bg-white/[0.06] transition-colors"
                >
                  {t('nav.login')}
                </Link>
                <Link
                  to="/auth?mode=register"
                  className="crimson-glow-btn rounded-lg px-3.5 py-1.5 text-xs font-semibold"
                >
                  {t('nav.signup')}
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#8B5CF6]/35 bg-[#8B5CF6]/10 px-3.5 py-1 text-xs font-mono font-medium text-[#C4B5FD]">
                <Cpu className="h-3.5 w-3.5 text-[#8B5CF6]" />
                <span>{t('landing.heroBadge')}</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#F4F5F7] leading-[1.08]">
                {t('landing.heroTitle')}
              </h1>

              <p className="text-base sm:text-lg text-[#9CA3AF] leading-relaxed max-w-2xl">
                {t('landing.heroSubtitle')}
              </p>

              <div className="flex flex-wrap items-center gap-3.5 pt-2">
                <Link
                  to={primaryCtaTo}
                  className="crimson-glow-btn inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold"
                >
                  <span>{t('landing.ctaPrimary')}</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>

                {user ? (
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#121317]/80 px-5 py-3 text-sm font-medium text-[#F4F5F7] hover:bg-white/[0.06] transition-colors"
                  >
                    {t('landing.ctaDashboard')}
                  </Link>
                ) : (
                  <Link
                    to="/auth?mode=login"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/[0.1] bg-[#121317]/80 px-5 py-3 text-sm font-medium text-[#F4F5F7] hover:bg-white/[0.06] transition-colors"
                  >
                    {t('landing.ctaSecondary')}
                  </Link>
                )}
              </div>
            </div>

            {/* Obsidian Telemetry Preview Panel */}
            <div className="lg:col-span-5">
              <div className="obsidian-glass rounded-2xl p-6 shadow-2xl space-y-5 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#10B981] animate-pulse" />
                    <span className="text-xs font-medium text-[#9CA3AF]">
                      {t('landing.telemetryLabel')}
                    </span>
                  </div>
                  <span className="rounded-md bg-[#10B981]/15 border border-[#10B981]/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#10B981]">
                    {t('landing.telemetryStatus')}
                  </span>
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[11px] font-mono text-[#9CA3AF]">02:48 / 05:00</div>
                    <div className="mt-1 text-3xl font-mono font-bold text-[#F4F5F7]">136 wpm</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#10B981]/15 border border-[#10B981]/30 px-3 py-1 text-xs font-medium text-[#10B981]">
                    <Activity className="h-3.5 w-3.5" />
                    {t('landing.telemetryWpm')}
                  </span>
                </div>

                {/* Simulated Obsidian Waveform Bars */}
                <div
                  aria-hidden="true"
                  className="obsidian-inset rounded-xl h-20 px-3 py-2.5 flex items-end justify-between gap-1.5"
                >
                  {[22, 46, 68, 52, 85, 92, 64, 40, 74, 88, 60, 35, 58, 82, 48, 28].map(
                    (height, idx) => (
                      <div
                        key={idx}
                        className="flex-1 rounded-full bg-gradient-to-t from-[#FF6363] to-[#8B5CF6]/80"
                        style={{ height: `${height}%`, opacity: 0.72 + (idx % 3) * 0.1 }}
                      />
                    )
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="obsidian-inset rounded-xl px-3.5 py-2.5 text-[#F59E0B]">
                    {t('landing.telemetryPauses')}
                  </div>
                  <div className="obsidian-inset rounded-xl px-3.5 py-2.5 text-[#10B981]">
                    {t('landing.telemetryFillers')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 4-Card Bento Grid */}
        <section
          aria-labelledby="bento-heading"
          className="mx-auto max-w-6xl px-4 pb-20 sm:px-6"
        >
          <div className="mb-8 max-w-2xl">
            <h2
              id="bento-heading"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F4F5F7]"
            >
              {t('landing.bentoHeading')}
            </h2>
            <p className="mt-2 text-sm sm:text-base text-[#9CA3AF]">
              {t('landing.bentoSubheading')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <BentoCard index={0} className="md:col-span-7 flex flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/35 text-[#A78BFA]">
                  <Cpu className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-2.5 py-1 text-[11px] font-mono text-[#C4B5FD]">
                  {t('landing.bento1Tag')}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-[#F4F5F7]">
                  {t('landing.bento1Title')}
                </h3>
                <p className="mt-2 text-sm text-[#9CA3AF] leading-relaxed">
                  {t('landing.bento1Desc')}
                </p>
              </div>
            </BentoCard>

            <BentoCard index={1} className="md:col-span-5 flex flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/35 text-[#F59E0B]">
                  <Timer className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-2.5 py-1 text-[11px] font-mono text-[#FCD34D]">
                  {t('landing.bento2Tag')}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-[#F4F5F7]">
                  {t('landing.bento2Title')}
                </h3>
                <p className="mt-2 text-sm text-[#9CA3AF] leading-relaxed">
                  {t('landing.bento2Desc')}
                </p>
              </div>
            </BentoCard>

            <BentoCard index={2} className="md:col-span-5 flex flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#10B981]/15 border border-[#10B981]/35 text-[#10B981]">
                  <Activity className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-[#10B981]/30 bg-[#10B981]/10 px-2.5 py-1 text-[11px] font-mono text-[#6EE7B7]">
                  {t('landing.bento3Tag')}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-[#F4F5F7]">
                  {t('landing.bento3Title')}
                </h3>
                <p className="mt-2 text-sm text-[#9CA3AF] leading-relaxed">
                  {t('landing.bento3Desc')}
                </p>
              </div>
            </BentoCard>

            <BentoCard index={3} className="md:col-span-7 flex flex-col justify-between gap-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FF6363]/15 border border-[#FF6363]/35 text-[#FF6363]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-[#FF6363]/30 bg-[#FF6363]/10 px-2.5 py-1 text-[11px] font-mono text-[#FCA5A5]">
                  {t('landing.bento4Tag')}
                </span>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-[#F4F5F7]">
                  {t('landing.bento4Title')}
                </h3>
                <p className="mt-2 text-sm text-[#9CA3AF] leading-relaxed">
                  {t('landing.bento4Desc')}
                </p>
              </div>
            </BentoCard>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.08] bg-[#07080A]/90">
        <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between gap-3 px-4 py-6 sm:px-6 text-xs text-[#9CA3AF]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#10B981]" />
            <span>{t('landing.footerNote')}</span>
          </div>
          <div className="font-mono text-[11px] text-[#6B7280]">
            EN / UA · Rust/WASM Telemetry
          </div>
        </div>
      </footer>
    </div>
  );
}
