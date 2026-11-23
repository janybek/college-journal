import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_MIME, mimeOf, viewWay, downloadName, sizeText, dueText, stateView, kindOfName, defaultDue, formProblems, gradeDraft, gradeNeedsReason, base64ToBytes } from '../site/js/work.js';
import { kindByName, FILE_KINDS } from '../core/files.js';

test('how a file is shown: by its kind only', () => {
  assert.deepEqual(['jpg', 'pdf', 'docx', 'svg', undefined].map(viewWay), ['image', 'open', 'download', 'download', 'download']);
  assert.deepEqual(['png', 'xlsx', 'html'].map(viewWay), ['image', 'download', 'download']);
  assert.deepEqual([mimeOf('png'), mimeOf('html')], ['image/png', 'application/octet-stream']);
  assert.deepEqual(Object.keys(FILE_MIME).sort(), [...FILE_KINDS].sort());
  assert.equal(mimeOf('__proto__'), 'application/octet-stream');
});

test('the name of a downloaded file', () => {
  assert.deepEqual([downloadName('Отчёт: итог?.pdf', 'pdf'), downloadName('a.jpg.exe', 'jpg'), downloadName('x', 'zzz')], ['Отчёт_ итог_.pdf', 'a.jpg.jpg', 'x.bin']);
  assert.equal(downloadName('..\\..\\evil/name.docx', 'docx'), '.._.._evil_name.docx');
  assert.equal(downloadName('', 'png'), 'file.png');
});

test('size of a file', () => {
  assert.deepEqual([sizeText(1), sizeText(1048575), sizeText(1572864)], [{ key: 'work.size.kb', params: { n: 1 } }, { key: 'work.size.kb', params: { n: 1024 } }, { key: 'work.size.mb', params: { n: '1,5' } }]);
});

test('deadline text', () => {
  assert.deepEqual(dueText('2026-09-27 23:59:00', '2026-09-27 10:00:00'), { key: 'work.due.today', params: { time: '23:59' }, tone: 'warning' });
  assert.equal(dueText('2026-09-27 23:59:00', '2026-09-28 00:00:00').key, 'work.due.overdue');
  assert.equal(dueText('2026-09-27 23:59:00', '2026-09-28 00:00:00').tone, 'danger');
  assert.equal(dueText('2026-09-28 08:00:00', '2026-09-27 10:00:00').key, 'work.due.tomorrow');
  assert.deepEqual(dueText('2026-10-03 18:30:00', '2026-09-27 10:00:00'), { key: 'work.due.date', params: { date: '03.10', time: '18:30' }, tone: 'neutral' });
});

test('state of a work', () => {
  assert.deepEqual(stateView('checked', false), { key: 'work.state.checked', tone: 'success' });
  assert.deepEqual(stateView('submitted', true), { key: 'work.state.submitted', tone: 'primary', lateKey: 'work.state.late' });
  assert.equal(stateView('none', false).tone, 'neutral');
  assert.equal(stateView('returned', false).tone, 'warning');
});

test('kindOfName gives what kindByName of the core gives', () => {
  const names = ['Фото 1.JPEG', 'scan.pdf', 'a.Docx', 'b.xls', 'a.jpg.exe', 'a', 'a.svg', 'a.html', 'a.docm', 'a.heic', 'a.txt', '.pdf', 'x.PNG', 'p.pptx', '__proto__', 'a.constructor'];
  assert.deepEqual(names.map(kindOfName), names.map(kindByName));
  assert.equal(kindOfName(null), null);
});

test('default deadline: a week from today, the end of the day', () => {
  assert.deepEqual(defaultDue('2026-09-27'), { dueDate: '2026-10-04', dueTime: '23:59' });
});

test('errors of the fields become keys of the form', () => {
  const map = formProblems([{ field: 'due', code: 'due_past' }, { field: 'title', code: 'empty' }, { field: 'due', code: 'bad_value' }]);
  assert.deepEqual([...map], [['due', 'work.form.error.due_past'], ['title', 'work.form.error.empty']]);
  assert.equal(formProblems(undefined).size, 0);
});

const attempt = (over) => ({ id: 'a1', n: 1, status: 'submitted', points: null, comment: '', paper: false, ...over });

test('the draft of a grade: nothing yet, or what the current attempt has', () => {
  assert.deepEqual(gradeDraft({ attempts: [] }), { verdict: 'checked', points: null, comment: '' });
  assert.deepEqual(gradeDraft({ attempts: [attempt({ id: 'a2', n: 2, status: 'checked', points: 15, comment: 'Хорошо' }), attempt({ n: 1, status: 'returned', comment: 'Старое' })] }),
    { verdict: 'checked', points: 15, comment: 'Хорошо' });
  assert.deepEqual(gradeDraft({ attempts: [attempt({ comment: 'Замечание' })] }), { verdict: 'checked', points: null, comment: 'Замечание' });
});

test('when a change of the grade needs a reason', () => {
  const none = { attempts: [] };
  const sent = { attempts: [attempt()] };
  const checked = { attempts: [attempt({ status: 'checked', points: 15, comment: 'ok' })] };
  assert.equal(gradeNeedsReason(none, { verdict: 'checked', points: 6, comment: '' }), false);
  assert.equal(gradeNeedsReason(sent, { verdict: 'checked', points: 8, comment: '' }), false);
  assert.equal(gradeNeedsReason(checked, { verdict: 'checked', points: 12, comment: 'ok' }), true);
  assert.equal(gradeNeedsReason(checked, { verdict: 'checked', points: '12', comment: 'ok' }), true);
  assert.equal(gradeNeedsReason(checked, { verdict: 'checked', points: 15, comment: 'новый' }), false);
  assert.equal(gradeNeedsReason(checked, { verdict: 'checked', points: '15', comment: 'новый' }), false);
  assert.equal(gradeNeedsReason(checked, { verdict: 'returned', points: null, comment: 'переделать' }), true);
  assert.equal(gradeNeedsReason(sent, { verdict: 'returned', points: null, comment: 'переделать' }), false);
});

test('base64 becomes bytes', () => {
  assert.deepEqual([...base64ToBytes('QUJD')], [65, 66, 67]);
  assert.ok(base64ToBytes('QUJD') instanceof Uint8Array);
});
