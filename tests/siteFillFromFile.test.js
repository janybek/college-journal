import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the file button is for the first fill only: no approved version and no topics in the draft', async () => {
  const { canFillFromFile } = await import('../site/js/fillFromFile.js');
  assert.deepEqual([canFillFromFile({ hasApproved: false, topicRows: 0 }), canFillFromFile({ hasApproved: false, topicRows: 12 }),
    canFillFromFile({ hasApproved: true, topicRows: 0 }), canFillFromFile({ hasApproved: true, topicRows: 12 })], [true, false, false, false]);
});

test('one button «Заполнить из файла» on the screens; the two old file entries are gone', () => {
  const view = (name) => fs.readFileSync(new URL(`../site/js/views/${name}.js`, import.meta.url), 'utf8');
  for (const name of ['subjects', 'syllabusForm']) {
    assert.match(view(name), /syllabus\.fillFromFile/, name);
    assert.match(view(name), /canFillFromFile/, name);
  }
  for (const name of ['subjects', 'syllabusForm', 'syllabusUpload']) assert.doesNotMatch(view(name), /['"`](syllabus\.upload|sform\.file\.upload)['"`]/, name);
  for (const lang of ['ru', 'ky', 'en']) {
    const dict = fs.readFileSync(new URL(`../site/js/i18n/${lang}.js`, import.meta.url), 'utf8');
    assert.match(dict, /['"]syllabus\.fillFromFile['"]/, lang);
    assert.doesNotMatch(dict, /['"](syllabus\.upload|sform\.file\.upload)['"]/, lang);
  }
});
