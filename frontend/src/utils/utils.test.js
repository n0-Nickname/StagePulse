import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculatePresentationScore, generateProfessorVerdict } from './roastGenerator.js';
import { unlockAudio, playReelTick, playReelLock, playMilestoneWin } from './slotSounds.js';

describe('roastGenerator', () => {
  it('calculates presentation scores across optimal, edge, and poor ranges', () => {
    expect(
      calculatePresentationScore({
        targetDurationSec: 180,
        actualDurationSec: 180,
        wpm: 135,
        pauseCount: 0,
        totalPauseSec: 0,
        wordCount: 400,
        fillerCount: 0,
      })
    ).toBe(100);

    expect(
      calculatePresentationScore({
        targetDurationSec: 100,
        actualDurationSec: 130, // 30% diff -> partial timing
        wpm: 90, // <110 -> partial wpm
        pauseCount: 3,
        totalPauseSec: 20, // 20/130 ~15% -> partial pause
        wordCount: 200,
        fillerCount: 10, // 5% -> partial filler
      })
    ).toBeGreaterThan(0);

    expect(
      calculatePresentationScore({
        targetDurationSec: 100,
        actualDurationSec: 200, // >=50% -> 0 timing
        wpm: 250, // >160 -> 0 wpm
        pauseCount: 10,
        totalPauseSec: 100, // >=35% -> 0 pause
        wordCount: 100,
        fillerCount: 20, // >=12% -> 0 filler
      })
    ).toBe(0);

    expect(calculatePresentationScore({})).toBe(30);
  });

  it('generates Strict Professor verdicts in both en and uk across all conditions', () => {
    expect(generateProfessorVerdict({ score: 92, lang: 'en' })).toMatch(/Sharp, disciplined/i);
    expect(
      generateProfessorVerdict({ score: 92, fillerBreakdown: { like: 3, um: 1 }, lang: 'en' })
    ).toMatch(/Trim "like"/i);
    expect(
      generateProfessorVerdict({ score: 70, fillerBreakdown: { um: 5 }, lang: 'en' })
    ).toMatch(/leaned on "um"/i);
    expect(generateProfessorVerdict({ score: 70, wpm: 180, lang: 'en' })).toMatch(/180 wpm/i);
    expect(generateProfessorVerdict({ score: 70, wpm: 90, lang: 'en' })).toMatch(/90 wpm/i);
    expect(
      generateProfessorVerdict({ score: 70, wpm: 130, timingStatus: 'overtime', lang: 'en' })
    ).toMatch(/past the clock/i);
    expect(
      generateProfessorVerdict({ score: 70, wpm: 130, pauseCount: 4, lang: 'en' })
    ).toMatch(/4 long pauses/i);
    expect(generateProfessorVerdict({ score: 70, wpm: 130, lang: 'en' })).toMatch(/Solid effort/i);

    expect(generateProfessorVerdict({ score: 92, lang: 'uk' })).toMatch(/Чітка/i);
    expect(
      generateProfessorVerdict({ score: 92, fillerBreakdown: { ну: 3 }, lang: 'uk' })
    ).toMatch(/Приберіть «ну»/i);
    expect(
      generateProfessorVerdict({ score: 70, fillerBreakdown: { типу: 4 }, lang: 'uk' })
    ).toMatch(/прозвучало 4/i);
    expect(generateProfessorVerdict({ score: 70, wpm: 180, lang: 'uk' })).toMatch(/180 сл\/хв/i);
    expect(generateProfessorVerdict({ score: 70, wpm: 90, lang: 'uk' })).toMatch(/90 сл\/хв/i);
    expect(
      generateProfessorVerdict({ score: 70, wpm: 130, timingStatus: 'overtime', lang: 'uk' })
    ).toMatch(/за межі регламенту/i);
    expect(
      generateProfessorVerdict({ score: 70, wpm: 130, pauseCount: 5, lang: 'uk' })
    ).toMatch(/5 довгі паузи/i);
    expect(generateProfessorVerdict({ score: 70, wpm: 130, lang: 'uk' })).toMatch(/Непогано/i);
  });
});

describe('slotSounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unlocks AudioContext, plays tick/lock/milestone, and skips when muted', async () => {
    // Muted paths return early
    playReelTick(true);
    playReelLock(0, true);
    playMilestoneWin(true);

    const ctx = unlockAudio();
    expect(ctx).toBeTruthy();
    ctx.state = 'suspended';
    ctx.resume = vi.fn().mockRejectedValue(new Error('suspended'));
    unlockAudio();

    playReelTick(false);
    playReelLock(0, false);
    playReelLock(99, false);
    playMilestoneWin(false);

    // Test fresh import with AudioContext unavailable
    const origAC = window.AudioContext;
    const origWac = window.webkitAudioContext;
    delete window.AudioContext;
    delete window.webkitAudioContext;
    vi.resetModules();
    const freshSounds = await import('./slotSounds.js');
    expect(freshSounds.unlockAudio()).toBeNull();
    freshSounds.playReelTick(false);
    freshSounds.playReelLock(0, false);
    freshSounds.playMilestoneWin(false);
    window.AudioContext = origAC;
    window.webkitAudioContext = origWac;
  });
});
