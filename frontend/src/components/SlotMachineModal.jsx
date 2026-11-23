import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Crown, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { slotsApi, formatApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTranslation } from '../context/LanguageContext.jsx';
import {
  unlockAudio,
  playReelTick,
  playReelLock,
  playMilestoneWin,
} from '../utils/slotSounds.js';

const SYMBOL_KEYS = ['MIC', 'TIMER', 'DIAMOND', 'FIRE', 'CLOWN'];

const SYMBOL_MAP = {
  MIC: { emoji: '🎙️', label: 'Mic' },
  TIMER: { emoji: '⏱️', label: 'Timer' },
  DIAMOND: { emoji: '💎', label: 'Diamond' },
  FIRE: { emoji: '🔥', label: 'Fire' },
  CLOWN: { emoji: '🤡', label: 'Clown' },
};

const DEFAULT_REELS = ['DIAMOND', 'MIC', 'TIMER'];
const REEL_HEIGHT_PX = 96; // h-24 = 96px
const STOP_DURATIONS_MS = [1000, 1600, 2300];
const FINALIZE_MS = 2350;
const CONFETTI_COLORS = ['#F59E0B', '#FF6363', '#8B5CF6', '#10B981'];

function buildStrip(targetSymbol, cycles = 3) {
  const strip = [];
  for (let c = 0; c < cycles; c++) {
    for (const key of SYMBOL_KEYS) {
      strip.push(key);
    }
  }
  strip.push(targetSymbol);
  return strip;
}

export default function SlotMachineModal({ isOpen, onClose }) {
  const { user, refreshUser, updateUser } = useAuth();
  const { t } = useTranslation();
  const [strips, setStrips] = useState(() =>
    DEFAULT_REELS.map((sym) => [sym])
  );
  const [offsets, setOffsets] = useState([0, 0, 0]);
  const [durations, setDurations] = useState([0, 0, 0]);
  const [spinningReels, setSpinningReels] = useState([false, false, false]);
  const [landedReels, setLandedReels] = useState([false, false, false]);
  const [spinPhase, setSpinPhase] = useState('idle'); // 'idle' | 'spinning' | 'won' | 'lost'
  const [muted, setMuted] = useState(false);
  const [bannerMessage, setBannerMessage] = useState('');
  const [error, setError] = useState('');

  const timersRef = useRef([]);
  const tickIntervalRef = useRef(null);
  const canvasRef = useRef(null);
  const confettiRafRef = useRef(null);
  const mutedRef = useRef(muted);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const stopTickLoop = useCallback(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }, []);

  const stopConfetti = useCallback(() => {
    if (confettiRafRef.current) {
      cancelAnimationFrame(confettiRafRef.current);
      confettiRafRef.current = null;
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const launchConfetti = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const originX = canvas.width / 2;
    const originY = canvas.height / 2;

    const particles = Array.from({ length: 160 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 12;
      const isCoin = Math.random() < 0.38;
      return {
        x: originX + (Math.random() - 0.5) * 90,
        y: originY + (Math.random() - 0.5) * 50,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 5,
        size: isCoin ? 7 + Math.random() * 4 : 6 + Math.random() * 6,
        color: isCoin
          ? '#F59E0B'
          : CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        isCoin,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.25,
        tilt: Math.random() * Math.PI,
        vTilt: 0.08 + Math.random() * 0.14,
        alpha: 1,
      };
    });

    const gravity = 0.28;
    const drag = 0.985;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      for (const p of particles) {
        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vRot;
        p.tilt += p.vTilt;
        if (p.y > canvas.height * 0.78) {
          p.alpha -= 0.024;
        }
        if (p.alpha <= 0 || p.y > canvas.height + 30) continue;

        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        const scaleX = Math.cos(p.tilt);
        ctx.scale(scaleX, 1);

        ctx.fillStyle = p.color;
        if (p.isCoin) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FEF3C7';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
        }
        ctx.restore();
      }

      if (alive) {
        confettiRafRef.current = requestAnimationFrame(animate);
      } else {
        confettiRafRef.current = null;
      }
    };

    stopConfetti();
    confettiRafRef.current = requestAnimationFrame(animate);
  }, [stopConfetti]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => clearTimeout(id));
      timersRef.current = [];
      stopTickLoop();
      stopConfetti();
    };
  }, [stopConfetti, stopTickLoop]);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setBannerMessage('');
      setSpinPhase(user?.is_pro ? 'won' : 'idle');
      setSpinningReels([false, false, false]);
      setLandedReels([false, false, false]);
      setDurations([0, 0, 0]);
      setOffsets([0, 0, 0]);
      if (user?.is_pro) {
        setStrips([['DIAMOND'], ['DIAMOND'], ['DIAMOND']]);
      } else {
        setStrips(DEFAULT_REELS.map((sym) => [sym]));
      }
    } else {
      stopConfetti();
    }
  }, [isOpen, user?.is_pro, stopConfetti]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && spinPhase !== 'spinning') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, spinPhase, onClose]);

  if (!isOpen) return null;

  const isSpinning = spinPhase === 'spinning';
  const isMilestoneUnlocked = spinPhase === 'won';

  const spinsRemaining =
    user?.spins_remaining !== undefined
      ? user.spins_remaining
      : Math.max(0, 3 - (user?.spin_count ?? 0));

  const handleSpin = async () => {
    unlockAudio();
    stopConfetti();

    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
    stopTickLoop();

    setError('');
    setBannerMessage('');
    setSpinPhase('spinning');
    setSpinningReels([true, true, true]);
    setLandedReels([false, false, false]);
    setDurations([0, 0, 0]);
    setOffsets([0, 0, 0]);

    tickIntervalRef.current = setInterval(() => {
      playReelTick(mutedRef.current);
    }, 110);

    try {
      const result = await slotsApi.spin();
      const targetReels = result.reels || DEFAULT_REELS;
      const newStrips = targetReels.map((sym, idx) =>
        buildStrip(sym, 3 + idx)
      );
      setStrips(newStrips);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setDurations(STOP_DURATIONS_MS);
          setOffsets(
            newStrips.map((strip) => -(strip.length - 1) * REEL_HEIGHT_PX)
          );
        });
      });

      STOP_DURATIONS_MS.forEach((ms, idx) => {
        const timer = setTimeout(() => {
          playReelLock(idx, mutedRef.current);
          setSpinningReels((prev) => {
            const next = [...prev];
            next[idx] = false;
            return next;
          });
          setLandedReels((prev) => {
            const next = [...prev];
            next[idx] = true;
            return next;
          });
        }, ms);
        timersRef.current.push(timer);
      });

      const finalTimer = setTimeout(async () => {
        stopTickLoop();
        const won = Boolean(result.is_pro);
        setSpinPhase(won ? 'won' : 'lost');
        setBannerMessage(
          won ? t('slots.milestoneTitle') : t('slots.tryAgain')
        );

        if (won) {
          playMilestoneWin(mutedRef.current);
          launchConfetti();
        }

        updateUser({
          is_pro: result.is_pro,
          spin_count: result.spin_count,
          spins_remaining: result.spins_remaining,
        });
        await refreshUser();
      }, FINALIZE_MS);
      timersRef.current.push(finalTimer);
    } catch (err) {
      stopTickLoop();
      setSpinningReels([false, false, false]);
      setSpinPhase('idle');
      setError(formatApiError(err, t));
    }
  };

  return (
    <div
      className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 backdrop-blur-md p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slot-modal-title"
    >
      {/* Full-screen Celebration Confetti Canvas Portal */}
      {typeof document !== 'undefined' &&
        createPortal(
          <canvas
            ref={canvasRef}
            data-testid="confetti-canvas"
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none',
              zIndex: 99999,
            }}
          />,
          document.body
        )}

      <div
        data-testid="slot-modal-card"
        className={`modal-spring-in relative w-full max-w-md overflow-hidden rounded-2xl obsidian-glass p-3 sm:p-6 shadow-2xl transition-all ${
          isMilestoneUnlocked
            ? 'milestone-frame-glow milestone-shake border-[#F59E0B]/80'
            : ''
        }`}
      >
        {/* Rotating Golden Sunburst behind housing on Milestone Unlock */}
        {isMilestoneUnlocked && (
          <div
            aria-hidden="true"
            className="milestone-sunburst pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] opacity-60"
          />
        )}

        {/* Top-right Mute & Close controls */}
        <div className="relative z-10 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setMuted((prev) => !prev)}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-[#9CA3AF] hover:bg-white/[0.08] hover:text-[#F4F5F7] transition-colors cursor-pointer"
          >
            {muted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSpinning}
            aria-label={t('common.close')}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-[#9CA3AF] hover:bg-white/[0.08] hover:text-[#F4F5F7] transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative z-10 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#FF6363]/15 border border-[#FF6363]/35 text-[#FF6363]">
            {isMilestoneUnlocked ? (
              <Crown className="h-6 w-6 text-[#F59E0B]" />
            ) : (
              <Sparkles className="h-6 w-6" />
            )}
          </div>
          <h2
            id="slot-modal-title"
            className="text-xl sm:text-2xl font-bold tracking-tight text-[#F4F5F7]"
          >
            {isMilestoneUnlocked ? t('slots.milestoneTitle') : t('slots.title')}
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-[#9CA3AF]">
            {isMilestoneUnlocked ? t('slots.milestoneDesc') : t('slots.subtitle')}
          </p>
        </div>

        {/* 3-Reel Pace Milestone Window */}
        <div
          data-testid="slot-reels-container"
          className="relative z-10 mt-4 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-4 rounded-2xl obsidian-inset p-3 sm:p-6 shadow-inner"
        >
          {strips.map((strip, idx) => {
            const spinning = spinningReels[idx];
            const landed = landedReels[idx];
            return (
              <div
                key={idx}
                className={`relative h-24 min-w-0 w-full overflow-hidden rounded-xl border bg-[#121317] ${
                  isMilestoneUnlocked
                    ? 'border-[#F59E0B]/70 bg-[#F59E0B]/10'
                    : 'border-white/[0.08]'
                }`}
              >
                {isMilestoneUnlocked && (
                  <div
                    aria-hidden="true"
                    className="winning-shine-sweep pointer-events-none absolute inset-0 z-10"
                  />
                )}
                <div
                  className={
                    isMilestoneUnlocked
                      ? 'winning-symbol-pop'
                      : landed && idx === 2
                      ? 'slot-reel-landed'
                      : ''
                  }
                  style={{
                    transform: `translateY(${offsets[idx]}px)`,
                    transitionProperty: 'transform',
                    transitionDuration: `${durations[idx]}ms`,
                    transitionTimingFunction: 'cubic-bezier(0.15, 0.85, 0.25, 1)',
                    filter: spinning ? 'blur(1.5px)' : 'none',
                  }}
                >
                  {strip.map((symbolKey, itemIdx) => {
                    const sym = SYMBOL_MAP[symbolKey] || SYMBOL_MAP.DIAMOND;
                    return (
                      <div
                        key={itemIdx}
                        className="flex h-24 min-w-0 flex-col items-center justify-center px-1"
                      >
                        <span
                          className="text-3xl sm:text-5xl leading-none select-none"
                          role="img"
                          aria-label={sym.label}
                        >
                          {sym.emoji}
                        </span>
                        <span className="mt-1.5 max-w-full truncate text-[clamp(9px,2.5vw,10px)] font-mono font-semibold uppercase tracking-wider text-[#9CA3AF]">
                          {sym.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Status / Error Banner */}
        {error && (
          <div
            role="alert"
            className="relative z-10 mt-4 rounded-xl border border-[#FF6363]/50 bg-[#FF6363]/12 px-3.5 py-2.5 text-center text-xs font-medium text-[#FCA5A5]"
          >
            {error}
          </div>
        )}

        {bannerMessage && !error && (
          <div
            data-testid="slot-banner-message"
            className={`relative z-10 mt-4 rounded-xl border px-3.5 py-2.5 text-center text-xs font-semibold ${
              isMilestoneUnlocked
                ? 'badge-slam-in border-[#F59E0B]/60 bg-[#10B981]/20 text-[#FDE68A]'
                : 'border-white/[0.08] bg-[#0B0C10] text-[#9CA3AF]'
            }`}
          >
            {bannerMessage}
          </div>
        )}

        {/* Action Button */}
        <div className="relative z-10 mt-4 sm:mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleSpin}
            disabled={isSpinning || (!user?.is_pro && spinsRemaining <= 0)}
            className="crimson-glow-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl disabled:opacity-50 px-4 py-3 text-sm font-semibold cursor-pointer"
          >
            <RotateCw className={`h-4 w-4 ${isSpinning ? 'animate-spin' : ''}`} />
            {isSpinning
              ? t('slots.spinning')
              : user?.is_pro
              ? t('slots.spin')
              : `${t('slots.spin')} (${spinsRemaining})`}
          </button>

          {user?.is_pro && (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] w-full rounded-xl bg-[#10B981] hover:bg-[#059669] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              {t('slots.done')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
