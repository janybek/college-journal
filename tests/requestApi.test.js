import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PASSWORD } from './journalSetup.js';
import { hashPassword } from '../core/auth.js';
import { REQUEST } from '../core/requests.js';
import { REQUEST_TABLES } from '../backend/requestData.js';

// Requests to change the closed data: filed by the teacher, approved by the deanery and the vice-rector, applied by the journal. Fictional people only.
const ready = () => { const s = setup(); s.unitNumbers(); s.closeUnit(1); s.at('2026-10-01'); return s; };
const staffToken = (s, key, roles) => {
  s.ids[key] = s.store.insert('staff', { fullName: 'Вымышленный ' + key, login: key, passwordHash: hashPassword(s.platform, PASSWORD), roles, lang: 'ky', mustChangePassword: false, active: true }).id;
  s.t[key] = s.call('auth.login', { login: key, password: PASSWORD }).data.token;
  return s.ids[key];
};
const maker = (s, base) => (data, token = s.t.teacher1) => s.call('request.create', { ...base, ...data }, token);
const control = (s) => maker(s, { kind: 'control', subjectId: s.sb1, unit: 1, studentId: s.a2, before: '25', after: '31', reason: 'ошибка при вводе' });
const decider = (s, id) => (data, token) => s.call('request.decide', { requestId: id, step: 'dean', verdict: 'approve', ...data }, token);
const both = (s, id) => { const d = decider(s, id); return [d({}, s.t.dean), d({ step: 'prorector' }, s.t.prorector)]; };
const logOf = (s, id) => s.store.list('changeLog').filter((r) => r.requestId === id);
const unitRow = (s, key, unit = 1) => s.store.list('unitResults').find((r) => r.studentId === s.ids[key] && r.unit === unit);
const ledgerRow = (s, key, who = 'dean') => s.call('ledger.get', { subjectId: s.sb1 }, s.t[who]).data.ledger.students.find((x) => x.id === s.ids[key]);

test('request.create and request.decide: rights, checks, the two steps and the application of a control request', () => {
  const s = ready();
  const mk = control(s);
  const before = s.snapshot();
  for (const who of ['teacher2', 'teacher3', 'dean', 'admin', 'prorector', 'a1']) assert.equal(mk({}, s.t[who]).error.code, 'forbidden', who);
  assert.equal(mk({ unit: 2 }).error.code, 'not_needed');
  assert.deepEqual(mk({ before: '24' }).error, { code: 'invalid', fields: [{ field: 'before', code: 'changed' }] });
  assert.deepEqual(mk({ after: '25' }).error.fields, [{ field: 'after', code: 'same' }]);
  for (const after of ['41', '-1', '3.5', 'x']) assert.deepEqual(mk({ after }).error.fields, [{ field: 'after', code: 'bad_value' }], after);
  assert.equal(mk({ after: 31 }).error.code, 'bad_request');
  assert.equal(mk({ kind: 'grade' }).error.code, 'bad_request');
  assert.equal(mk({ before: 25 }).error.code, 'bad_request');
  assert.deepEqual(mk({ reason: '  ' }).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.deepEqual(mk({ reason: 'я'.repeat(301) }).error.fields, [{ field: 'reason', code: 'too_long' }]);
  for (const studentId of [s.b1, [s.a2], 5, 'нет']) assert.deepEqual(mk({ studentId }).error.fields, [{ field: 'studentId', code: 'bad_ref' }]);
  for (const subjectId of [[s.sb1], 5, '__proto__']) assert.equal(mk({ subjectId }).error.code, 'not_found');
  for (const unit of [3, 1.5, '1', null]) assert.deepEqual(mk({ unit }).error.fields, [{ field: 'unit', code: 'bad_value' }], String(unit));
  assert.deepEqual(s.snapshot(), before);

  const made = mk({}).data.request;
  const id = made.id;
  assert.deepEqual([made.status, made.kind, made.unit, made.before, made.after, made.attemptNo, made.authorName, made.studentName, made.subjectName, made.groupName],
    ['dean', 'control', 1, '25', '31', null, 'Иванова Нургуль', 'Өмүров Канат', 'Информатика', '01-1']);
  assert.deepEqual(made.can, { decide: false, withdraw: true });
  assert.equal(s.store.list('changeLog').filter((r) => r.requestId === id).length, 0);
  assert.equal(mk({}).error.code, 'request_exists');
  const decide = decider(s, id);
  const mid = s.snapshot();
  for (const who of ['teacher1', 'teacher2', 'prorector', 'admin', 'a1']) assert.equal(decide({}, s.t[who]).error.code, 'forbidden', who);
  assert.equal(decide({ step: 'prorector' }, s.t.dean).error.code, 'request_changed');
  assert.equal(decide({ verdict: 'maybe' }, s.t.dean).error.code, 'bad_request');
  assert.deepEqual(decide({ verdict: 'reject', note: '' }, s.t.dean).error.fields, [{ field: 'note', code: 'required' }]);
  assert.equal(decide({ requestId: 'нет' }, s.t.dean).error.code, 'not_found');
  assert.equal(decide({ requestId: [id] }, s.t.dean).error.code, 'not_found');
  assert.deepEqual(s.snapshot(), mid);
  assert.equal(decide({}, s.t.dean).data.request.status, 'prorector');
  assert.equal(decide({}, s.t.dean).error.code, 'request_changed');
  assert.equal(decide({ step: 'prorector' }, s.t.dean).error.code, 'forbidden');
  const row = s.store.list('requests')[0];
  assert.deepEqual([row.deanBy, row.finalBy, row.attemptId], [s.ids.dean, '', '']);

  const done = decide({ step: 'prorector' }, s.t.prorector).data;
  assert.deepEqual([done.stale, done.request.status, done.request.finalName, done.request.deanName], [false, 'applied', 'Проректоров Талант', 'Деканова Айгуль']);
  assert.deepEqual(logOf(s, id).map((r) => [r.entity, r.field, r.before, r.after, r.reason, r.actorId, r.unit, r.late]), [['unit', 'control', '25', '31', 'ошибка при вводе', s.ids.teacher1, 1, true]]);
  const a2 = ledgerRow(s, 'a2').units[0];
  assert.deepEqual([a2.control, a2.total, a2.word], [31, 63, 'fair']);
  assert.deepEqual(s.store.list('unitResults').filter((r) => r.studentId === s.a2 && r.unit === 1).length, 1);
  const after = s.snapshot();
  assert.equal(decide({ step: 'prorector' }, s.t.prorector).error.code, 'request_closed');
  assert.deepEqual(s.snapshot(), after);
  assert.equal(JSON.stringify(done).includes('passwordHash'), false);
});

test('request.decide: a request that no longer matches the data is closed as stale; nothing is written', () => {
  const s = ready();
  const mk = control(s);
  const id = mk({ studentId: s.a1, before: '30', after: '35' }).data.request.id;
  const decide = decider(s, id);
  assert.equal(decide({}, s.t.dean).data.request.status, 'prorector');
  s.store.update('unitResults', unitRow(s, 'a1').id, { control: 28 });
  const before = s.snapshot();
  const res = decide({ step: 'prorector' }, s.t.prorector).data;
  assert.deepEqual([res.stale, res.request.status], [true, 'stale']);
  assert.notEqual(res.request.closedAt, '');
  assert.equal(unitRow(s, 'a1').control, 28);
  assert.equal(logOf(s, id).length, 0);
  assert.equal(s.snapshot().changeLog.length, before.changeLog.length);

  // the scheme changed: 20 is no longer allowed for the self-work
  const second = mk({ kind: 'self', studentId: s.a1, before: '16', after: '20' }).data.request.id;
  const d2 = decider(s, second);
  assert.equal(d2({}, s.t.dean).data.request.status, 'prorector');
  s.store.insert('settings', { key: 'scoreSelf', value: '15' });
  s.store.insert('settings', { key: 'scoreCurrent', value: '45' });
  assert.equal(d2({ step: 'prorector' }, s.t.prorector).data.stale, true);
  assert.equal(unitRow(s, 'a1').self, 16);

  // the unit was opened again
  const third = mk({ studentId: s.a2 }).data.request.id;
  s.store.update('closures', s.store.list('closures')[0].id, { reopenedAt: '2026-10-02 10:00:00', reopenedBy: s.ids.admin });
  assert.equal(decider(s, third)({}, s.t.dean).data.stale, true);
  assert.equal(unitRow(s, 'a2').control, 25);
});

test('request.decide: reject, withdraw', () => {
  const s = ready();
  const mk = control(s);
  const id = mk({}).data.request.id;
  const decide = decider(s, id);
  const before = s.snapshot().unitResults;
  const rejected = decide({ verdict: 'reject', note: 'не подтверждено' }, s.t.dean).data;
  assert.deepEqual([rejected.stale, rejected.request.status, rejected.request.closeNote, rejected.request.deanName], [false, 'rejected', 'не подтверждено', 'Деканова Айгуль']);
  assert.notEqual(rejected.request.closedAt, '');
  assert.deepEqual(s.snapshot().unitResults, before);
  assert.equal(decide({}, s.t.dean).error.code, 'request_closed');
  const again = mk({}).data.request.id;
  assert.notEqual(again, id);

  // rejected at the second step: the vice-rector is written
  assert.equal(decider(s, again)({}, s.t.dean).ok, true);
  const second = decider(s, again)({ step: 'prorector', verdict: 'reject', note: 'нет оснований' }, s.t.prorector).data.request;
  assert.deepEqual([second.status, second.finalName, second.finalAt === '', second.closeNote], ['rejected', 'Проректоров Талант', false, 'нет оснований']);
  assert.deepEqual(s.snapshot().unitResults, before);

  // withdraw
  const third = mk({}).data.request.id;
  const w = (requestId, token = s.t.teacher1) => s.call('request.withdraw', { requestId }, token);
  assert.equal(w(third, s.t.teacher2).error.code, 'forbidden');
  assert.equal(w('нет').error.code, 'not_found');
  assert.equal(w([third]).error.code, 'not_found');
  assert.equal(s.call('request.withdraw', { requestId: third }, s.t.dean).error.code, 'forbidden');
  const gone = w(third).data.request;
  assert.deepEqual([gone.status, gone.can], ['withdrawn', { decide: false, withdraw: false }]);
  assert.notEqual(gone.closedAt, '');
  assert.equal(w(third).error.code, 'request_closed');
  assert.equal(w(id).error.code, 'request_closed');
  assert.equal(decider(s, third)({}, s.t.dean).error.code, 'request_closed');
  assert.equal(mk({}).ok, true);
});

test('request.decide: nobody approves their own request or both steps; the administrator only when there is no one else', () => {
  const s = setup();
  s.unitNumbers();
  s.closeUnit(1);
  // the subject of the dean himself
  s.store.update('subjects', s.sb1, { teacherId: s.ids.dean });
  s.at('2026-10-01');
  const mk = maker(s, { kind: 'control', subjectId: s.sb1, unit: 1, studentId: s.a2, before: '25', after: '31', reason: 'ошибка при вводе' });
  const id = mk({}, s.t.dean).data.request.id;
  const decide = decider(s, id);
  assert.equal(decide({}, s.t.dean).error.code, 'forbidden');
  assert.equal(decide({}, s.t.admin).data.request.status, 'prorector');

  // a second dean appears: the administrator is not needed any more
  staffToken(s, 'dean2', 'dean');
  const id2 = mk({ studentId: s.a1, before: '30', after: '35' }, s.t.dean).data.request.id;
  assert.equal(decider(s, id2)({}, s.t.admin).error.code, 'forbidden');
  assert.equal(decider(s, id2)({}, s.t.dean).error.code, 'forbidden');
  assert.equal(decider(s, id2)({}, s.t.dean2).data.request.status, 'prorector');

  // one person on both steps
  staffToken(s, 'both', 'dean,prorector');
  const id3 = mk({ studentId: s.a3, before: '', after: '20' }, s.t.dean).data.request.id;
  const d3 = decider(s, id3);
  assert.equal(d3({}, s.t.both).data.request.status, 'prorector');
  assert.equal(d3({ step: 'prorector' }, s.t.both).error.code, 'forbidden');
  assert.equal(d3({ step: 'prorector' }, s.t.admin).error.code, 'forbidden');
  // the only other vice-rector loses the role: the administrator may decide the second step
  s.store.update('staff', s.ids.prorector, { roles: 'teacher' });
  assert.equal(d3({ step: 'prorector' }, s.t.prorector).error.code, 'forbidden');
  assert.equal(d3({ step: 'prorector' }, s.t.admin).data.request.status, 'applied');
  assert.equal(unitRow(s, 'a3').control, 20);

  // a person who is switched off does not decide, whatever the roles in the old token say
  const id4 = mk({ kind: 'self', studentId: s.a1, before: '16', after: '18' }, s.t.dean).data.request.id;
  s.store.update('staff', s.ids.dean2, { active: false });
  assert.equal(decider(s, id4)({}, s.t.dean2).error.code, 'unauthorized');
});

test('request.create / decide: the mark of a pair of a closed unit', () => {
  const s = ready();
  const mk = maker(s, { kind: 'mark', subjectId: s.sb1, pairId: s.p0901, studentId: s.a2, before: 'absent|0|', after: 'excused|0|', reason: 'принесена справка' });
  const before = s.snapshot();
  assert.deepEqual(mk({ pairId: s.p0915 }).error.code, 'pair_locked');
  assert.equal(mk({ pairId: s.q0904 }).error.code, 'not_found');
  assert.equal(mk({ pairId: [s.p0901] }).error.code, 'not_found');
  assert.deepEqual(mk({ after: 'gone|0|' }).error.fields, [{ field: 'after', code: 'bad_value' }]);
  assert.deepEqual(mk({ after: '' }).error.fields, [{ field: 'after', code: 'bad_value' }]);
  assert.deepEqual(mk({ after: 'present|0|5' }).error.fields, [{ field: 'after', code: 'not_allowed' }]);
  assert.deepEqual(mk({ before: 'present|0|' }).error.fields, [{ field: 'before', code: 'changed' }]);
  assert.deepEqual(mk({ pairId: s.p0908, studentId: s.a1, before: 'present|0|7', after: 'present|0|99' }).error.fields, [{ field: 'after', code: 'bad_value' }]);
  assert.deepEqual(mk({ after: 'absent|0|' }).error.fields, [{ field: 'after', code: 'same' }]);
  assert.deepEqual(s.snapshot(), before);
  const id = mk({}).data.request;
  assert.deepEqual([id.unit, id.pairId, id.pairDate, id.pairSlot, id.before, id.after], [1, s.p0901, '2026-09-01', 1, 'absent|0|', 'excused|0|']);
  const [first, applied] = both(s, id.id);
  assert.deepEqual([first.data.request.status, applied.data.request.status], ['prorector', 'applied']);
  const log = logOf(s, id.id);
  assert.deepEqual(log.map((r) => [r.entity, r.field, r.before, r.after, r.pairId, r.studentId, r.unit, r.late, r.actorId]), [['mark', 'status', 'absent', 'excused', s.p0901, s.a2, 1, true, s.ids.teacher1]]);
  const mark = s.store.list('attendance').filter((r) => r.pairId === s.p0901 && r.studentId === s.a2).pop();
  assert.deepEqual([mark.status, mark.source, mark.markedBy], ['excused', 'teacher', s.ids.teacher1]);
  const r = ledgerRow(s, 'a2');
  assert.deepEqual([r.units[0].current, r.units[0].total, r.semester], [33, 70, 42]);
});

test('request.create: the mark of a pair of an open unit is a request only when the term has passed and the teacher cannot do it himself', () => {
  const s = ready();
  s.store.update('pairs', s.p0915, { status: 'closed' });
  s.mark(s.p0915, 'a2', 'absent', null, '2026-09-15 08:10:00');
  const mk = maker(s, { kind: 'mark', subjectId: s.sb1, pairId: s.p0915, studentId: s.a2, before: 'absent|0|', after: 'excused|0|', reason: 'справка' });
  assert.equal(mk({}).error.code, 'not_needed');                                            // the teacher does this himself
  assert.deepEqual(mk({ before: 'present|0|', after: 'present|0|5' }).error.fields, [{ field: 'before', code: 'changed' }]);
  const ok = mk({ after: 'present|0|5' });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.request.unit, 2);
  // the term has not passed: the teacher edits freely
  const p0929 = s.pairOf(s.sb1, '2026-09-29');
  s.store.update('pairs', p0929.id, { status: 'closed' });
  assert.equal(mk({ pairId: p0929.id, before: '', after: 'present|0|' }).error.code, 'not_needed');
  // a pair not held
  assert.equal(mk({ pairId: s.p0922, before: '', after: 'present|0|' }).error.code, 'pair_locked');
  s.store.update('pairs', s.p0922, { status: 'running' });
  assert.equal(mk({ pairId: s.p0922, before: '', after: 'present|0|' }).error.code, 'pair_locked');
  // the first mark of a student on a held pair: the mark of the closed unit may be created
  const p0908 = mk({ pairId: s.p0908, studentId: s.a3, before: 'absent|0|', after: 'madeup|0|' });
  assert.equal(p0908.ok, true);
  assert.equal(p0908.data.request.unit, 1);
});

test('request.create / decide: current, self and control values; the work of self-work', () => {
  const s = ready();
  const mk = maker(s, { kind: 'current', subjectId: s.sb1, unit: 1, studentId: s.a1, before: '', after: '30', reason: 'пересчитано' });
  const before = s.snapshot();
  assert.deepEqual(mk({ after: '41' }).error.fields, [{ field: 'after', code: 'bad_value' }]);
  assert.deepEqual(mk({ kind: 'self', before: '16', after: '21' }).error.fields, [{ field: 'after', code: 'bad_value' }]);
  assert.deepEqual(s.snapshot(), before);
  const id = mk({}).data.request.id;
  const [, applied] = both(s, id);
  assert.equal(applied.data.request.status, 'applied');
  assert.equal(unitRow(s, 'a1').currentManual, 30);
  assert.deepEqual(ledgerRow(s, 'a1').units[0].current, 30);
  assert.deepEqual(logOf(s, id).map((r) => [r.entity, r.field, r.before, r.after]), [['unit', 'current', '', '30']]);
  // the way back: the computed value
  const back = mk({ before: '30', after: '' }).data.request.id;
  both(s, back);
  assert.equal(unitRow(s, 'a1').currentManual, null);
  assert.deepEqual(logOf(s, back).map((r) => [r.field, r.before, r.after]), [['current', '30', '']]);

  // self-work by hand: a unit without assignments works, a unit with assignments does not; a student without a row gets a row
  const self = mk({ kind: 'self', studentId: s.a3, before: '', after: '14' });
  assert.equal(self.ok, true);
  both(s, self.data.request.id);
  assert.equal(unitRow(s, 'a3').self, 14);
  assert.equal(unitRow(s, 'a3').control, null);
  s.task({ unit: 1 });
  assert.deepEqual(mk({ kind: 'self', studentId: s.a1, before: '16', after: '18' }).error.fields, [{ field: 'unit', code: 'self_by_work' }]);
  assert.equal(s.store.list('unitResults').filter((r) => r.studentId === s.a3).length, 1);
});

test('request.create / decide: the points of a self-work assignment of a closed unit', () => {
  const s = ready();
  const taskId = s.task({ unit: 1, maxPoints: 10 });
  s.attempt(taskId, 'a1', { status: 'checked', points: 8, checkedBy: s.ids.teacher1, checkedAt: '2026-09-19 10:00:00' });
  const mk = maker(s, { kind: 'work', subjectId: s.sb1, unit: 1, assignmentId: taskId, studentId: s.a1, before: '8', after: '10', reason: 'проверено неверно' });
  assert.equal(mk({ assignmentId: 'нет' }).error.code, 'not_found');
  assert.equal(mk({ assignmentId: [taskId] }).error.code, 'not_found');
  for (const after of ['11', '', '-1', 'x']) assert.deepEqual(mk({ after }).error.fields, [{ field: 'after', code: 'bad_value' }], after);
  const hw = s.task({ kind: 'hw', unit: null });
  assert.equal(mk({ assignmentId: hw }).error.code, 'not_needed');
  const open = s.task({ unit: 2 });
  const before = s.snapshot();
  assert.equal(mk({ assignmentId: open }).error.code, 'not_needed');
  assert.deepEqual(s.snapshot(), before);

  const id = mk({}).data.request.id;
  const [, applied] = both(s, id);
  assert.equal(applied.data.request.status, 'applied');
  const row = s.store.list('submissions').find((r) => r.assignmentId === taskId);
  assert.deepEqual([row.points, row.status, row.checkedBy], [10, 'checked', s.ids.teacher1]);
  assert.deepEqual(logOf(s, id).map((r) => [r.entity, r.field, r.before, r.after, r.assignmentId, r.unit, r.late]), [['work', 'points', '8', '10', taskId, 1, true]]);
  assert.equal(ledgerRow(s, 'a1').units[0].self, 20);

  // no attempt: a paper attempt appears with the points and the status
  const paper = mk({ studentId: s.a3, before: '', after: '6' });
  assert.equal(paper.ok, true);
  both(s, paper.data.request.id);
  const made = s.store.list('submissions').find((r) => r.assignmentId === taskId && r.studentId === s.a3);
  assert.deepEqual([made.paper, made.points, made.status, made.n], [true, 6, 'checked', 1]);
  assert.deepEqual(logOf(s, paper.data.request.id).map((r) => [r.field, r.before, r.after]), [['points', '', '6'], ['status', '', 'checked']]);

  // a submitted work that was not checked yet gets the status too
  const sub = mk({ studentId: s.a2, before: '', after: '4' });
  s.attempt(taskId, 'a2', { status: 'submitted' });
  assert.equal(mk({ studentId: s.a2, before: '', after: '4' }).error.code, 'request_exists');
  both(s, sub.data.request.id);
  assert.equal(s.store.list('submissions').filter((r) => r.studentId === s.a2 && r.assignmentId === taskId).length, 1);

  // the student handed in again between the filing and the approval: stale
  const again = mk({ studentId: s.a1, before: '10', after: '9' });
  assert.equal(decider(s, again.data.request.id)({}, s.t.dean).ok, true);
  s.attempt(taskId, 'a1', { n: 2, status: 'submitted', submittedAt: '2026-10-01 11:00:00' });
  assert.equal(decider(s, again.data.request.id)({ step: 'prorector' }, s.t.prorector).data.stale, true);
  assert.equal(s.store.list('submissions').find((r) => r.assignmentId === taskId && r.studentId === s.a1 && r.n === 1).points, 10);
});

test('request.create / decide: the result of the exam of a subject', () => {
  const s = setup();
  s.allUnits();
  s.examHead();
  s.examRow(s.a1, { score: 35 });
  s.examRow(s.a2, { score: 20 });
  s.at('2027-01-20');
  const mk = maker(s, { kind: 'exam', subjectId: s.sb1, studentId: s.a2, before: '20', after: '24', reason: 'пересчитана работа' });
  assert.equal(mk({}).error.code, 'not_needed');                                           // the final sheet is open: changed directly
  const finalId = s.closeFinal();
  const before = s.snapshot();
  assert.deepEqual(mk({ before: '21' }).error.fields, [{ field: 'before', code: 'changed' }]);
  for (const after of ['41', '', 'passed', '3.5']) assert.deepEqual(mk({ after }).error.fields, [{ field: 'after', code: 'bad_value' }], after);
  assert.deepEqual(mk({ after: '20' }).error.fields, [{ field: 'after', code: 'same' }]);
  assert.deepEqual(mk({ studentId: s.a3, before: '', after: '20' }).error.fields, [{ field: 'studentId', code: 'no_attempt' }]);
  for (const who of ['teacher2', 'dean', 'a1']) assert.equal(mk({}, s.t[who]).error.code, 'forbidden', who);
  assert.deepEqual(s.snapshot(), before);

  const made = mk({}).data.request;
  assert.deepEqual([made.kind, made.attemptNo, made.unit, made.before, made.after], ['exam', 1, null, '20', '24']);
  assert.equal(mk({}).error.code, 'request_exists');
  const attempts = s.store.list('examAttempts').length;
  const [, applied] = both(s, made.id);
  assert.equal(applied.data.request.status, 'applied');
  assert.equal(s.store.list('examAttempts').length, attempts);
  const a2 = s.store.list('examAttempts').find((r) => r.studentId === s.a2);
  assert.deepEqual([a2.no, a2.outcome, a2.score, a2.updatedBy], [1, 'score', 24, s.ids.teacher1]);
  const row = ledgerRow(s, 'a2');
  assert.deepEqual([row.exam, row.total, row.word], [24, 62, 'fair']);
  assert.deepEqual(logOf(s, made.id).map((r) => [r.entity, r.field, r.before, r.after, r.reason, r.actorId, r.unit, r.late, r.studentId]),
    [['subjectExam', 'try1', '20', '24', 'пересчитана работа', s.ids.teacher1, null, true, s.a2]]);

  // absent and back
  const gone = mk({ studentId: s.a1, before: '35', after: 'absent' });
  both(s, gone.data.request.id);
  const absent = ledgerRow(s, 'a1');
  assert.deepEqual([absent.status, absent.total], ['absent', null]);
  both(s, mk({ studentId: s.a1, before: 'absent', after: '35' }).data.request.id);
  assert.equal(ledgerRow(s, 'a1').total, 82);

  // the control of the closed unit changes the semester and the total with the exam
  both(s, mk({ kind: 'control', unit: 1, before: '25', after: '31', reason: 'ошибка при вводе' }).data.request.id);
  const sem = ledgerRow(s, 'a2');
  assert.deepEqual([sem.semester, sem.total, sem.word], [40, 64, 'fair']);

  // the final sheet is opened again between the filing and the approval: stale
  const reopened = mk({ studentId: s.a1, before: '35', after: '33' });
  const d = decider(s, reopened.data.request.id);
  d({}, s.t.dean);
  s.store.update('closures', finalId, { reopenedAt: '2027-01-21 10:00:00', reopenedBy: s.ids.admin });
  assert.equal(d({ step: 'prorector' }, s.t.prorector).data.stale, true);
  s.store.update('closures', finalId, { reopenedAt: '', reopenedBy: '' });
  assert.equal(s.store.list('examAttempts').find((r) => r.studentId === s.a1).score, 35);
});

test('request.decide of the exam: a retake added after the filing makes the request stale; a request for the last of two attempts', () => {
  const s = setup();
  s.allUnits();
  s.examHead();
  s.examRow(s.a1, { score: 35 });
  s.examRow(s.a2, { score: 20 });
  s.at('2027-01-20');
  s.closeFinal();
  const mk = maker(s, { kind: 'exam', subjectId: s.sb1, studentId: s.a2, before: '20', after: '21', reason: 'описка' });
  const id = mk({}).data.request.id;
  const decide = decider(s, id);
  assert.equal(decide({}, s.t.dean).ok, true);
  const retake = s.call('ledger.addAttempt', { subjectId: s.sb1, studentId: s.a2, date: '2027-01-12', outcome: 'score', score: 21, commission: '' }, s.t.dean);
  assert.equal(retake.ok, true, JSON.stringify(retake.error));
  const rows = s.snapshot().examAttempts;
  const res = decide({ step: 'prorector' }, s.t.prorector).data;
  assert.deepEqual([res.stale, res.request.status], [true, 'stale']);
  assert.deepEqual(s.snapshot().examAttempts, rows);

  // the last attempt is the target
  assert.equal(mk({ before: '20', after: '22' }).error.code, 'invalid');
  const last = mk({ before: '21', after: '25' });
  assert.equal(last.data.request.attemptNo, 2);
  both(s, last.data.request.id);
  const list = s.store.list('examAttempts').filter((r) => r.studentId === s.a2).sort((a, b) => a.no - b.no);
  assert.deepEqual(list.map((r) => [r.no, r.score]), [[1, 20], [2, 25]]);
  assert.deepEqual(logOf(s, last.data.request.id).map((r) => [r.field, r.before, r.after]), [['try2', '21', '25']]);
});

test('request.mine and request.queue: who sees which requests; the answers hold no secrets', () => {
  const s = ready();
  const mk = control(s);
  const id = mk({}).data.request.id;
  const other = mk({ studentId: s.a1, before: '30', after: '35' }).data.request.id;
  decider(s, other)({ verdict: 'reject', note: 'нет' }, s.t.dean);

  const mine = s.call('request.mine', {}, s.t.teacher1).data;
  assert.equal(mine.today, '2026-10-01');
  assert.deepEqual(mine.requests.map((r) => r.id).sort(), [id, other].sort());
  assert.deepEqual(s.call('request.mine', {}, s.t.teacher2).data.requests, []);
  for (const who of ['admin', 'prorector', 'a1']) assert.equal(s.call('request.mine', {}, s.t[who]).error.code, 'forbidden', who);
  assert.equal(JSON.stringify(mine).includes('passwordHash'), false);

  const q = (who) => s.call('request.queue', {}, s.t[who]);
  const dean = q('dean').data;
  assert.deepEqual(dean.requests.map((r) => r.id), [id, other]);                       // open first, closed after
  assert.deepEqual(dean.requests.map((r) => r.can.decide), [true, false]);
  assert.equal(dean.waiting, 1);
  assert.equal(q('prorector').data.waiting, 0);
  assert.equal(q('admin').data.waiting, 0);
  for (const who of ['teacher1', 'a1', 'teacher2']) assert.equal(q(who).error.code, 'forbidden', who);
  const text = JSON.stringify(dean);
  for (const word of ['passwordHash', 'cardNo', '"login"']) assert.equal(text.includes(word), false, word);

  // the vice-rector sees the second step
  decider(s, id)({}, s.t.dean);
  assert.equal(q('prorector').data.waiting, 1);
  assert.equal(q('dean').data.waiting, 0);
  assert.equal(q('prorector').data.requests[0].can.decide, true);
  assert.equal(q('admin').data.requests[0].can.decide, false);

  // the teacher of the subject changed: the old author does not see the request
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher2 });
  assert.deepEqual(s.call('request.mine', {}, s.t.teacher1).data.requests, []);
});

test('request.queue: a student never sees a request; no word of a request in the answers of the student', () => {
  const s = ready();
  control(s)({});
  for (const action of ['request.create', 'request.mine', 'request.queue', 'request.decide', 'request.withdraw']) assert.equal(s.call(action, {}, s.t.a1).error.code, 'forbidden', action);
  const grades = JSON.stringify(s.call('student.grades', {}, s.t.a2));
  assert.equal(/request|заявк/i.test(grades), false);
});

test('request.create: 50 open requests of one author are the limit; each table is read once', () => {
  const s = ready();
  const mk = control(s);
  for (let i = 0; i < REQUEST.openMax; i += 1) s.request({ kind: 'mark', pairId: 'p' + i });
  assert.equal(mk({}).error.code, 'too_many');
  s.store.update('requests', s.store.list('requests')[0].id, { status: 'withdrawn', closedAt: '2026-10-01 10:00:00' });
  s.spy.reset();
  const made = mk({});
  assert.equal(made.ok, true);
  for (const table of REQUEST_TABLES) assert.equal(s.spy.lists[table], 1, 'create ' + table);

  s.spy.reset();
  assert.equal(decider(s, made.data.request.id)({}, s.t.dean).ok, true);
  for (const table of REQUEST_TABLES) assert.equal(s.spy.lists[table], 1, 'decide ' + table);
  s.spy.reset();
  assert.equal(decider(s, made.data.request.id)({ step: 'prorector' }, s.t.prorector).ok, true);
  for (const table of REQUEST_TABLES) assert.equal(s.spy.lists[table], 1, 'apply ' + table);

  s.spy.reset();
  assert.equal(s.call('request.queue', {}, s.t.dean).ok, true);
  for (const table of REQUEST_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, 'queue ' + table);
  s.spy.reset();
  assert.equal(s.call('request.mine', {}, s.t.teacher1).ok, true);
  for (const table of REQUEST_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, 'mine ' + table);
});

test('request.create: the text after is stored and compared as the journal writes it (final review, M1)', () => {
  const s = ready();
  const mk = control(s);
  const before = s.snapshot();
  assert.deepEqual(mk({ after: '025' }).error.fields, [{ field: 'after', code: 'same' }]);
  assert.deepEqual(s.snapshot(), before);
  const made = mk({ after: '031' });
  assert.equal(made.data.request.after, '31');
  assert.equal(s.store.list('requests').find((r) => r.id === made.data.request.id).after, '31');
});
