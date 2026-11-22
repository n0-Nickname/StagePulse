import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { translations } from '../i18n/translations.js';

test('translations has complete uk and en dictionaries', () => {
  assert.equal(translations.uk.nav.practice, 'Студія');
  assert.equal(translations.en.nav.practice, 'Studio');
  assert.equal(translations.uk.metrics.optimal, 'Оптимальний темп');
  assert.equal(translations.uk.dashboard.onTime, 'Вчасно');
  assert.equal(translations.uk.dashboard.overtime, 'Перевищення часу');
});

test('useSpeechAnalytics defaults speechLang to uk-UA and sets recognition.lang', () => {
  const hookPath = path.resolve(import.meta.dirname, '../hooks/useSpeechAnalytics.js');
  const src = fs.readFileSync(hookPath, 'utf8');
  assert.match(src, /speechLang\s*=\s*['"]uk-UA['"]/);
  assert.match(src, /recognition\.lang\s*=\s*speechLangRef\.current/);
});
