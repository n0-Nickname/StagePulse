import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mic, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from '../context/LanguageContext.jsx';
import { formatApiError } from '../api/client.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';

export default function AuthPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login';

  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorObj, setErrorObj] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { login, register } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const paramMode = searchParams.get('mode');
    if (paramMode === 'register' || paramMode === 'login') {
      setMode(paramMode);
      setErrorObj(null);
    }
  }, [searchParams]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setErrorObj(null);
    setSearchParams({ mode: nextMode }, { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorObj(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({ email, password });
      }
      navigate('/practice');
    } catch (err) {
      setErrorObj(err);
    } finally {
      setSubmitting(false);
    }
  };

  const inlineError = errorObj ? formatApiError(errorObj, t) : null;

  return (
    <div className="min-h-screen bg-[#07080A] text-[#F4F5F7] flex flex-col">
      <header className="border-b border-white/[0.08] bg-[#07080A]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-[#9CA3AF] hover:text-[#F4F5F7] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t('auth.backHome')}</span>
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 obsidian-glass rounded-2xl overflow-hidden shadow-2xl">
          <div className="md:col-span-6 p-8 sm:p-10 flex flex-col justify-between border-b md:border-b-0 md:border-r border-white/[0.08] bg-[#0B0C10]/60">
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#FF6363]">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FF6363]/15 border border-[#FF6363]/35">
                  <Mic className="h-3.5 w-3.5" />
                </span>
                <span>{t('common.brand')}</span>
              </div>

              <h1 className="mt-6 text-3xl sm:text-4xl font-bold tracking-tight text-[#F4F5F7] leading-tight">
                {t('auth.tagline')}
              </h1>
              <p className="mt-4 text-sm text-[#9CA3AF] leading-relaxed max-w-sm">
                {t('auth.description')}
              </p>
            </div>

            <div className="mt-10 pt-6 border-t border-white/[0.08] grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-[#F4F5F7] font-semibold">{t('auth.feature1Title')}</div>
                <div className="mt-1 font-mono text-[11px] text-[#10B981]">{t('auth.feature1Desc')}</div>
              </div>
              <div>
                <div className="text-[#F4F5F7] font-semibold">{t('auth.feature2Title')}</div>
                <div className="mt-1 font-mono text-[11px] text-[#F59E0B]">{t('auth.feature2Desc')}</div>
              </div>
            </div>
          </div>

          <div className="md:col-span-6 p-8 sm:p-10 flex flex-col justify-center">
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="flex items-center gap-6 border-b border-white/[0.08] mb-6"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => switchMode('login')}
                className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                  mode === 'login'
                    ? 'border-[#FF6363] text-[#F4F5F7]'
                    : 'border-transparent text-[#9CA3AF] hover:text-[#F4F5F7]'
                }`}
              >
                {t('auth.signInTab')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => switchMode('register')}
                className={`pb-3 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
                  mode === 'register'
                    ? 'border-[#FF6363] text-[#F4F5F7]'
                    : 'border-transparent text-[#9CA3AF] hover:text-[#F4F5F7]'
                }`}
              >
                {t('auth.registerTab')}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5"
                >
                  {t('auth.emailLabel')}
                </label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  required
                  className="w-full rounded-xl obsidian-inset px-3.5 py-2.5 text-sm text-[#F4F5F7] placeholder-[#6B7280] focus:outline-none focus:border-[#FF6363] focus:ring-1 focus:ring-[#FF6363]/40 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1.5"
                >
                  {t('auth.passwordLabel')}
                </label>
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  required
                  minLength={mode === 'register' ? 6 : 1}
                  className="w-full rounded-xl obsidian-inset px-3.5 py-2.5 text-sm text-[#F4F5F7] placeholder-[#6B7280] focus:outline-none focus:border-[#FF6363] focus:ring-1 focus:ring-[#FF6363]/40 transition-colors"
                />
              </div>

              {inlineError && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="flex items-start gap-2.5 rounded-xl bg-[#FF6363]/12 border border-[#FF6363]/60 px-3.5 py-2.5 text-xs font-medium text-[#FCA5A5]"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-[#FF6363] mt-0.5" />
                  <span>{inlineError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="crimson-glow-btn w-full mt-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? t('common.pleaseWait')
                  : mode === 'login'
                  ? t('auth.signInBtn')
                  : t('auth.registerBtn')}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
