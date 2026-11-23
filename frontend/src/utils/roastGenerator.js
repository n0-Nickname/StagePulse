export function calculatePresentationScore({
  targetDurationSec = 180,
  actualDurationSec = 0,
  wpm = 0,
  pauseCount = 0,
  totalPauseSec = 0,
  wordCount = 0,
  fillerCount = 0,
}) {
  // 1. Timing (40 pts): 100% if within ±10% of target, scales down to 0 at ±50%+
  let timingScore = 0;
  if (targetDurationSec > 0 && actualDurationSec > 0) {
    const diffRatio = Math.abs(actualDurationSec - targetDurationSec) / targetDurationSec;
    if (diffRatio <= 0.1) {
      timingScore = 40;
    } else if (diffRatio >= 0.5) {
      timingScore = 0;
    } else {
      timingScore = Math.round(40 * (1 - (diffRatio - 0.1) / 0.4));
    }
  }

  // 2. WPM (30 pts): optimal 110-160 wpm
  let wpmScore = 0;
  if (wpm >= 110 && wpm <= 160) {
    wpmScore = 30;
  } else if (wpm > 0) {
    const dist = wpm < 110 ? 110 - wpm : wpm - 160;
    wpmScore = Math.max(0, Math.round(30 * (1 - dist / 60)));
  }

  // 3. Low pause ratio (15 pts): based on totalPauseSec / actualDurationSec
  let pauseScore = 15;
  if (actualDurationSec > 0) {
    const pauseRatio = totalPauseSec / actualDurationSec;
    if (pauseRatio <= 0.05) {
      pauseScore = 15;
    } else if (pauseRatio >= 0.35) {
      pauseScore = 0;
    } else {
      pauseScore = Math.round(15 * (1 - (pauseRatio - 0.05) / 0.3));
    }
  }

  // 4. Low filler density (15 pts): based on fillerCount / wordCount
  let fillerScore = 15;
  if (wordCount > 0) {
    const fillerRatio = fillerCount / wordCount;
    if (fillerRatio <= 0.01) {
      fillerScore = 15;
    } else if (fillerRatio >= 0.12) {
      fillerScore = 0;
    } else {
      fillerScore = Math.round(15 * (1 - (fillerRatio - 0.01) / 0.11));
    }
  }

  return Math.max(0, Math.min(100, timingScore + wpmScore + pauseScore + fillerScore));
}

export function generateProfessorVerdict({
  score = 0,
  wpm = 0,
  pauseCount = 0,
  fillerBreakdown = {},
  timingStatus = 'on_time',
  lang = 'uk',
}) {
  const topFillerEntry = Object.entries(fillerBreakdown || {}).sort((a, b) => b[1] - a[1])[0];
  const topFillerWord = topFillerEntry?.[0];
  const topFillerCount = topFillerEntry?.[1] || 0;

  if (lang === 'en') {
    if (score >= 88) {
      return topFillerCount >= 3
        ? `Impressive command of the room (${score}/100). Trim "${topFillerWord}" (${topFillerCount}x) and you are keynote-ready.`
        : `Sharp, disciplined delivery (${score}/100). Even I have nothing to complain about—almost.`;
    }
    if (topFillerCount >= 4) {
      return `You leaned on "${topFillerWord}" ${topFillerCount} times. Silence is free; use it instead of verbal clutter.`;
    }
    if (wpm > 165) {
      return `At ${wpm} wpm, you are outrunning your audience's comprehension. Breathe between ideas.`;
    }
    if (wpm > 0 && wpm < 105) {
      return `${wpm} wpm is a bit too relaxed. Pick up the cadence before the front row nods off.`;
    }
    if (timingStatus === 'overtime') {
      return `You ran past the clock. Cut your weakest example and land the conclusion on time.`;
    }
    if (pauseCount >= 4) {
      return `${pauseCount} long pauses broke your momentum. Rehearse your transitions until they are automatic.`;
    }
    return `Solid effort (${score}/100), but there is room to tighten your pacing and transitions.`;
  }

  // Ukrainian ("Strict Professor" persona)
  if (score >= 88) {
    return topFillerCount >= 3
      ? `Гідний виступ (${score}/100). Приберіть «${topFillerWord}» (${topFillerCount} разів) — і буде бездоганно.`
      : `Чітка, дисциплінована подача (${score}/100). Навіть суворий професор не має до чого причепитися.`;
  }
  if (topFillerCount >= 4) {
    return `Слово «${topFillerWord}» прозвучало ${topFillerCount} разів. Пауза звучить розумніше за словесне сміття.`;
  }
  if (wpm > 165) {
    return `Темп ${wpm} сл/хв — ви мчите швидше, ніж аудиторія встигає думати. Робіть паузи між тезами.`;
  }
  if (wpm > 0 && wpm < 105) {
    return `${wpm} сл/хв — занадто мляво. Додайте енергії, інакше перший ряд засне.`;
  }
  if (timingStatus === 'overtime') {
    return `Ви вийшли за межі регламенту. Скоротіть слабкий приклад і завершуйте вчасно.`;
  }
  if (pauseCount >= 4) {
    return `${pauseCount} довгі паузи зламали ритм виступу. Відпрацюйте переходи між слайдами.`;
  }
  return `Непогано (${score}/100), але темп і переходи ще потребують шліфування.`;
}
