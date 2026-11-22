import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from '../context/LanguageContext.jsx';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { login, register } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({ email, username, password });
      }
      navigate('/practice');
    } catch (err) {
      setError(err?.message || t('auth.authFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1E1D1B] text-[#EAE6DF] flex items-center justify-center px-4 py-12 font-['Inter',sans-serif]">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 border border-[#3A3834] rounded-xl overflow-hidden bg-[#2A2926] shadow-xl">
        <div className="md:col-span-6 p-8 sm:p-10 flex flex-col justify-between border-b md:border-b-0 md:border-r border-[#3A3834] bg-[#242320]">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-[#D97757]">
                <span className="h-2 w-2 rounded-full bg-[#D97757]" />
                {t('common.brand')}
              </div>
              <div
                role="group"
                aria-label="Language switch"
                className="inline-flex items-center rounded-md border border-[#3A3834] bg-[#1E1D1B] p-0.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() => setLang('uk')}
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
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
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                    lang === 'en'
                      ? 'bg-[#D97757] text-white'
                      : 'text-[#9E9A92] hover:text-[#EAE6DF]'
                  }`}
                >
                  EN
                </button>
              </div>
            </div>
            <h1 className="mt-6 text-3xl sm:text-4xl font-medium tracking-tight text-[#EAE6DF] leading-tight font-['Lora','Newsreader',serif]">
              {t('auth.tagline')}
            </h1>
            <p className="mt-4 text-sm text-[#9E9A92] leading-relaxed max-w-sm">
              {t('auth.description')}
            </p>
          </div>

          <div className="mt-10 pt-6 border-t border-[#3A3834] grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-[#EAE6DF] font-medium">{t('auth.feature1Title')}</div>
              <div className="mt-0.5 text-[#9E9A92]">{t('auth.feature1Desc')}</div>
            </div>
            <div>
              <div className="text-[#EAE6DF] font-medium">{t('auth.feature2Title')}</div>
              <div className="mt-0.5 text-[#9E9A92]">{t('auth.feature2Desc')}</div>
            </div>
          </div>
        </div>

        <div className="md:col-span-6 p-8 sm:p-10 flex flex-col justify-center bg-[#2A2926]">
          <div className="flex items-center gap-6 border-b border-[#3A3834] mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'border-[#D97757] text-[#EAE6DF]'
                  : 'border-transparent text-[#9E9A92] hover:text-[#EAE6DF]'
              }`}
            >
              {t('auth.signInTab')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'border-[#D97757] text-[#EAE6DF]'
                  : 'border-transparent text-[#9E9A92] hover:text-[#EAE6DF]'
              }`}
            >
              {t('auth.registerTab')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#EAE6DF] mb-1.5">
                {t('auth.emailLabel')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                required
                className="w-full rounded-lg bg-[#1E1D1B] border border-[#3A3834] px-3.5 py-2.5 text-sm text-[#EAE6DF] placeholder-[#9E9A92]/60 focus:outline-none focus:border-[#D97757]"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-[#EAE6DF] mb-1.5">
                  {t('auth.usernameLabel')}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('auth.usernamePlaceholder')}
                  required
                  className="w-full rounded-lg bg-[#1E1D1B] border border-[#3A3834] px-3.5 py-2.5 text-sm text-[#EAE6DF] placeholder-[#9E9A92]/60 focus:outline-none focus:border-[#D97757]"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#EAE6DF] mb-1.5">
                {t('auth.passwordLabel')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                required
                minLength={6}
                className="w-full rounded-lg bg-[#1E1D1B] border border-[#3A3834] px-3.5 py-2.5 text-sm text-[#EAE6DF] placeholder-[#9E9A92]/60 focus:outline-none focus:border-[#D97757]"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg bg-[#D97757]/15 border border-[#D97757] px-3.5 py-2.5 text-sm font-medium text-[#F2A68D]"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 py-2.5 rounded-lg text-sm font-medium bg-[#D97757] hover:bg-[#C46647] text-white transition-colors disabled:opacity-50 cursor-pointer"
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
    </div>
  );
}
