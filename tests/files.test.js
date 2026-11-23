import test from 'node:test';
import assert from 'node:assert/strict';
import { FILE_LIMITS, FILE_KINDS, cleanFileName, kindByName, base64Bytes, sniffKind, isStoredName } from '../core/files.js';
import { SAMPLE, FAKE } from './fakes/sampleFiles.js';

test('limits and kinds are fixed', () => {
  assert.equal(FILE_LIMITS.maxBytes, 10485760);
  assert.equal(FILE_LIMITS.perWork, 5);
  assert.equal(FILE_LIMITS.perDayCount, 60);
  assert.equal(FILE_LIMITS.perDayBytes, 209715200);
  assert.equal(FILE_LIMITS.nameMax, 120);
  assert.equal(FILE_LIMITS.keepPendingMs, 86400000);
  assert.ok(Object.isFrozen(FILE_LIMITS));
  assert.equal(FILE_KINDS.length, 9);
});

test('kindByName by the last extension', () => {
  assert.deepEqual(['Фото 1.JPEG', 'scan.pdf', 'a.Docx', 'b.xls', 'a.jpg.exe', 'a', 'a.svg', 'a.html', 'a.docm', 'a.heic', 'a.txt', '.pdf'].map(kindByName),
    ['jpg', 'pdf', 'docx', 'xls', null, null, null, null, null, null, null, 'pdf']);
});

test('cleanFileName strips paths and control characters', () => {
  assert.deepEqual(['..\\..\\x/evil.pdf', 'a\u0000b.pdf', 'gpj\u202Eexe.pdf', '  ', null, '<script>.pdf'].map(cleanFileName),
    ['evil.pdf', 'ab.pdf', 'gpjexe.pdf', 'file', 'file', '<script>.pdf']);
  const long = cleanFileName('я'.repeat(300) + '.pdf');
  assert.deepEqual([long.length, long.endsWith('.pdf')], [120, true]);
  const astral = cleanFileName('\u{1F600}'.repeat(300) + '.pdf');
  assert.deepEqual([Array.from(astral).length, astral.endsWith('.pdf')], [120, true]);
  assert.equal(cleanFileName('a/'), 'file');
});

test('base64Bytes validates strictly', () => {
  assert.deepEqual(['QUJD', 'QUI=', 'QQ==', '', 'QUJ', 'QU=D', 'QUJD\n', 'Q===', ' QUJD', 5, null].map(base64Bytes), [3, 2, 1, 0, null, null, null, null, null, null, null]);
  assert.equal(base64Bytes('A'.repeat(13981016)), 10485762);
});

test('sniffKind by content', () => {
  for (const kind of ['jpg', 'png', 'pdf', 'docx', 'xlsx', 'pptx', 'doc']) assert.equal(sniffKind(SAMPLE[kind], kind), kind, kind);
  assert.deepEqual([sniffKind(SAMPLE.doc, 'xls'), sniffKind(SAMPLE.doc, 'ppt')], ['xls', 'ppt']);
  assert.deepEqual([sniffKind(SAMPLE.jpg, 'png'), sniffKind(SAMPLE.docx, 'xlsx'), sniffKind(SAMPLE.pdf, 'docx')], [null, null, null]);
  assert.deepEqual([sniffKind(FAKE.exe, 'jpg'), sniffKind(FAKE.svg, 'png'), sniffKind(FAKE.html, 'pdf'), sniffKind(FAKE.zip, 'docx'),
    sniffKind(FAKE.docm, 'docx'), sniffKind(FAKE.docMacro, 'doc'), sniffKind(new Uint8Array(0), 'pdf'), sniffKind('%PDF-1.7', 'pdf'), sniffKind(SAMPLE.pdf, 'svg')],
  [null, null, null, null, null, null, null, null, null]);
});

test('sniffKind rejects macros in xlsx and pptx and in old formats', () => {
  assert.equal(sniffKind(FAKE.docMacro, 'xls'), null);
  assert.equal(sniffKind(FAKE.docMacro, 'ppt'), null);
  assert.equal(sniffKind(SAMPLE.xlsx, 'xlsx'), 'xlsx');
});

test('isStoredName', () => {
  assert.deepEqual([isStoredName('a'.repeat(32) + '.bin'), isStoredName('A'.repeat(32) + '.bin'), isStoredName('../' + 'a'.repeat(29) + '.bin'), isStoredName('a'.repeat(32))], [true, false, false, false]);
  assert.equal(isStoredName('a'.repeat(32) + '.bin\n'), false);
});
