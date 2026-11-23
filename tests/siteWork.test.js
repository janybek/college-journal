import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILE_MIME, mimeOf, viewWay, downloadName, sizeText, dueText, stateView, kindOfName, defaultDue, formProblems, gradeDraft, gradeNeedsReason, base64ToBytes, homeCardLines, pickProblem, uploadErrorCode, uploadErrorKey, dueOfWork, dueDateText, mayStillSend, staffMay, overviewRows, overviewGroups } from '../site/js/work.js';
import { fitSize, photoName } from '../site/js/photo.js';
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

test('the size of a photo after shrinking: the long side is at most 1600, the proportions stay, small ones are not enlarged', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(fitSize(3000, 4000), { width: 1200, height: 1600 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitSize(1601, 1), { width: 1600, height: 1 });
  assert.deepEqual(fitSize(1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitSize(10000, 10), { width: 1600, height: 2 });
});

test('the name of a shrunk photo ends with .jpg', () => {
  assert.equal(photoName('IMG_1.HEIC'), 'IMG_1.jpg');
  assert.equal(photoName('a.b.png'), 'a.b.jpg');
  assert.equal(photoName('noext'), 'noext.jpg');
  assert.equal(photoName(''), 'photo.jpg');
});

test('the card of the student shows only the counts that are not zero, in a fixed order', () => {
  assert.deepEqual(homeCardLines({ fresh: 2, soon: 1, overdue: 0, returned: 1 }).map((l) => l.key), ['work.home.fresh', 'work.home.soon', 'work.home.returned']);
  assert.deepEqual(homeCardLines({ fresh: 2, soon: 1, overdue: 0, returned: 1 })[0], { key: 'work.home.fresh', params: { n: 2 }, tone: 'neutral' });
  assert.deepEqual(homeCardLines({ fresh: 0, soon: 0, overdue: 3, returned: 0 }), [{ key: 'work.home.overdue', params: { n: 3 }, tone: 'danger' }]);
  assert.deepEqual(homeCardLines({ fresh: 0, soon: 0, overdue: 0, returned: 0 }), []);
  assert.deepEqual(homeCardLines(null), []);
});

test('a file is checked before it is read: kind, size, count; photos are shrunk, so only their count counts', () => {
  const MB = 1048576;
  const file = (name, size, type = '') => ({ name, size, type });
  assert.equal(pickProblem(file('a.exe', 10), kindOfName('a.exe'), 0), 'work.pick.badType');
  assert.equal(pickProblem(file('a.pdf', 11 * MB), 'pdf', 0), 'work.pick.tooBig');
  assert.equal(pickProblem(file('a.pdf', 10 * MB), 'pdf', 0), null);
  assert.equal(pickProblem(file('a.pdf', 1), 'pdf', 5), 'work.pick.tooMany');
  assert.equal(pickProblem(file('a.pdf', 1), 'pdf', 4), null);
  assert.equal(pickProblem(file('big.jpg', 15 * MB, 'image/jpeg'), 'jpg', 0), null);
  assert.equal(pickProblem(file('IMG.HEIC', 15 * MB, 'image/heic'), null, 0), null);
  assert.equal(pickProblem(file('big.jpg', 15 * MB, 'image/jpeg'), 'jpg', 5), 'work.pick.tooMany');
});

test('the code of an upload failure: the code of a field, else the code of the answer; and the text key of it', () => {
  const fieldError = (code) => ({ code: 'invalid', fields: [{ field: 'data', code }] });
  assert.equal(uploadErrorCode(fieldError('bad_file')), 'bad_file');
  assert.equal(uploadErrorCode(fieldError('too_big')), 'too_big');
  assert.equal(uploadErrorCode({ code: 'invalid', fields: [{ field: 'name', code: 'bad_type' }] }), 'bad_type');
  assert.equal(uploadErrorCode({ code: 'invalid', fields: [] }), 'invalid');
  assert.equal(uploadErrorCode({ code: 'upload_limit' }), 'upload_limit');
  assert.equal(uploadErrorCode(new Error('photo_unreadable')), 'photo_unreadable');
  assert.equal(uploadErrorCode(null), 'internal');
  assert.equal(uploadErrorKey('bad_type'), 'work.upload.error.bad_type');
  assert.equal(uploadErrorKey('__proto__'), null);
  assert.equal(uploadErrorKey('forbidden'), null);
});

test('the deadline of a student: live until the work is handed in or sent back, only the date after', () => {
  const now = '2026-09-28 10:00:00';
  const due = '2026-09-27 23:59:00';
  assert.equal(dueOfWork(due, now, 'none').key, 'work.due.overdue');
  assert.equal(dueOfWork(due, now, 'returned').key, 'work.due.overdue');
  assert.deepEqual(dueOfWork(due, now, 'submitted'), { key: 'work.due.date', params: { date: '27.09', time: '23:59' }, tone: 'neutral' });
  assert.deepEqual(dueOfWork(due, now, 'checked'), dueDateText(due));
});

test('a queued upload is sent only on its own screen and under the token of the person who chose the files', () => {
  assert.equal(mayStillSend(true, 'tok-a', 'tok-a'), true);
  assert.equal(mayStillSend(false, 'tok-a', 'tok-a'), false);   // the screen was left
  assert.equal(mayStillSend(true, 'tok-a', 'tok-b'), false);    // another student signed in
  assert.equal(mayStillSend(true, 'tok-a', null), false);       // the session ended (unauthorized)
  assert.equal(mayStillSend(true, null, null), false);
});

test('the office reads, a teacher in the teacher role changes: the buttons follow the active role', () => {
  assert.deepEqual(staffMay({ manage: true, grade: true }, 'teacher'), { manage: true, grade: true });
  assert.deepEqual(staffMay({ manage: true, grade: true }, 'dean'), { manage: false, grade: false });
  assert.deepEqual(staffMay({ manage: true, grade: true }, 'admin'), { manage: false, grade: false });
  assert.deepEqual(staffMay({ manage: false, grade: false }, 'teacher'), { manage: false, grade: false });
  assert.deepEqual(staffMay(undefined, 'teacher'), { manage: false, grade: false });
});

test('overviewRows: a teacher role sees only the own subjects; the office all; a group and a search narrow them', () => {
  const list = [
    { subjectId: 'a', name: 'Информатика', groupName: '01-1', teacherName: 'Иванова Н.', own: true },
    { subjectId: 'b', name: 'Анатомия', groupName: '01-1', teacherName: 'Петров А.', own: false },
    { subjectId: 'c', name: 'Информатика', groupName: '02-1', teacherName: 'Петров А.', own: false },
  ];
  const ids = (rows) => rows.map((r) => r.subjectId);
  assert.deepEqual(ids(overviewRows(list, { role: 'teacher' })), ['a']);
  assert.deepEqual(ids(overviewRows(list, { role: 'dean' })), ['a', 'b', 'c']);
  assert.deepEqual(ids(overviewRows(list, { role: 'prorector', group: '02-1' })), ['c']);
  assert.deepEqual(ids(overviewRows(list, { role: 'dean', query: ' информ ' })), ['a', 'c']);
  assert.deepEqual(ids(overviewRows(list, { role: 'dean', query: 'петров', group: '01-1' })), ['b']);
  assert.deepEqual(ids(overviewRows(undefined, { role: 'dean' })), []);
  assert.deepEqual(overviewGroups(list), ['01-1', '02-1']);
});
