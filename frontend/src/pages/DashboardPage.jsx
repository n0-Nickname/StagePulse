import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Mic, RefreshCw } from 'lucide-react';
import { presentationsApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from '../context/LanguageContext.jsx';
import StatsOverview from '../components/StatsOverview.jsx';
import HistoryTable from '../components/HistoryTable.jsx';

export default function DashboardPage() {
  const { user, openSlotModal } = useAuth();
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPresentations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await presentationsApi.list();
      setData(res);
    } catch (err) {
      setError(err?.message || t('dashboard.loading'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPresentations();
  }, [fetchPresentations, user?.is_pro]);

  const isPro = Boolean(data?.is_pro ?? user?.is_pro);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-editorial text-3xl sm:text-4xl font-semibold tracking-tight text-[#EAE6DF]">
            {t('dashboard.title')}
          </h1>
          <p className="mt-1 text-sm text-[#9E9A92]">
            {t('dashboard.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!isPro && (
            <button
              type="button"
              onClick={openSlotModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D97757] hover:bg-[#C46647] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              {t('nav.unlockPro')}
            </button>
          )}
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#3A3834] bg-[#2A2926] hover:bg-[#3A3834]/50 px-4 py-2.5 text-sm font-medium text-[#EAE6DF] shadow-sm transition-colors cursor-pointer"
          >
            <Mic className="h-4 w-4 text-[#D97757]" />
            {t('dashboard.newSession')}
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-[#D97757]/40 bg-[#D97757]/15 px-4 py-3 text-sm text-[#EAE6DF]">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchPresentations}
            className="inline-flex items-center gap-1 font-semibold underline cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-28 rounded-2xl border border-[#3A3834] bg-[#2A2926] animate-pulse"
              />
            ))}
          </div>
          <div className="h-64 rounded-2xl border border-[#3A3834] bg-[#2A2926] animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          <StatsOverview
            stats={data?.stats}
            isPro={isPro}
            onUnlockClick={openSlotModal}
          />
          <HistoryTable
            items={data?.items || []}
            isPro={isPro}
            lockedHistoryCount={data?.locked_history_count || 0}
            onUnlockClick={openSlotModal}
          />
        </div>
      )}
    </div>
  );
}
