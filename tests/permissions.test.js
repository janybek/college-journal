import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, listPermissions, actionKind } from '../core/permissions.js';

test('can: role-gated table actions', () => {
  assert.equal(can(['dean'], 'dir.save', 'students'), true);
  assert.equal(can(['dean'], 'dir.save', 'staff'), false);
  assert.equal(can(['dean'], 'dir.resetPassword', 'staff'), false);
  assert.equal(can(['dean'], 'dir.resetPassword', 'students'), true);
  assert.equal(can(['admin'], 'dir.resetPassword', 'staff'), true);
  assert.equal(can(['admin'], 'dir.resetPassword', 'groups'), false);
  assert.equal(can(['prorector'], 'dir.list', 'staff'), true);
  assert.equal(can(['prorector'], 'dir.save', 'groups'), false);
  assert.equal(can(['teacher'], 'dir.list', 'students'), false);
  assert.equal(can(['admin'], 'import.apply', 'staff'), true);
  assert.equal(can(['dean'], 'dir.list', 'nope'), false);
  assert.equal(can(['admin'], 'dir.list'), false);
});

test('can: table-less, public and any actions', () => {
  assert.equal(can(['dean', 'teacher'], 'teacher.mySubjects'), true);
  assert.equal(can(['dean'], 'teacher.mySubjects'), false);
  assert.equal(can(['student'], 'auth.me'), true);
  assert.equal(can(['student'], 'user.setLang'), true);
  assert.equal(can([], 'auth.me'), false);
  assert.equal(can([], 'auth.login'), true);
  assert.equal(can([], 'i18n.overrides'), true);
  assert.equal(can(['admin'], 'нет.такого'), false);
  assert.equal(can(undefined, 'auth.login'), true);
});

test('actionKind', () => {
  assert.equal(actionKind('auth.login'), 'public');
  assert.equal(actionKind('auth.me'), 'any');
  assert.equal(actionKind('dir.list'), 'role');
  assert.equal(actionKind('teacher.mySubjects'), 'role');
  assert.equal(actionKind('нет.такого'), null);
  assert.equal(actionKind('toString'), null);
});

test('listPermissions', () => {
  assert.deepEqual(listPermissions(['student']), ['announce.list', 'checkin.current', 'checkin.mark', 'repeat.mine', 'schedule.mine', 'student.grades', 'student.subjects', 'syllabus.file', 'syllabus.get', 'work.dropFile', 'work.file', 'work.get', 'work.mine', 'work.submit', 'work.upload']);
  const dean = listPermissions(['dean']);
  assert.ok(dean.includes('import.apply:students'));
  assert.ok(!dean.includes('dir.save:staff'));
  assert.deepEqual(dean, [...dean].sort());
  const both = listPermissions(['dean', 'teacher']);
  assert.ok(both.includes('teacher.mySubjects'));
  assert.equal(new Set(both).size, both.length);
  assert.ok(listPermissions(['admin']).includes('dir.resetPassword:staff'));
  assert.ok(!listPermissions(['admin']).includes('auth.me'));
});

test('can: schedule actions', () => {
  assert.equal(can(['dean'], 'dir.save', 'weekTemplate'), true);
  assert.equal(can(['prorector'], 'dir.save', 'weekTemplate'), false);
  assert.equal(can(['prorector'], 'dir.list', 'weekTemplate'), true);
  assert.equal(can(['teacher'], 'dir.list', 'topics'), false);
  assert.equal(can(['dean'], 'import.apply', 'weekTemplate'), false);
  assert.equal(can(['prorector'], 'schedule.list'), true);
  assert.equal(can(['prorector'], 'schedule.changePair'), false);
  assert.equal(can(['teacher'], 'schedule.changePair'), false);
  assert.equal(can(['teacher'], 'syllabus.get'), true);
  assert.equal(can(['student'], 'schedule.mine'), true);
  assert.equal(can(['student'], 'schedule.list'), false);
  assert.equal(can(['dean'], 'schedule.mine'), false);
  assert.ok(listPermissions(['dean']).includes('settings.save'));
});

test('the syllabus file: attach and drop for the deanery, the administrator and a teacher; reading for everybody', () => {
  for (const action of ['syllabus.attachFile', 'syllabus.dropFile']) assert.deepEqual(['admin', 'dean', 'prorector', 'teacher', 'student'].map((r) => can([r], action)), [true, true, false, true, false], action);
  assert.deepEqual(['admin', 'dean', 'prorector', 'teacher', 'student'].map((r) => can([r], 'syllabus.file')), [true, true, true, true, true]);
});

test('a file fills the draft: the deanery, the administrator and a teacher (of his own subject: the server checks); topics have no directory', () => {
  for (const role of ['admin', 'dean', 'teacher']) assert.equal(can([role], 'syllabus.apply'), true);
  for (const role of ['admin', 'dean', 'teacher']) assert.equal(can([role], 'syllabus.preview'), true);
  for (const role of ['prorector', 'student']) assert.equal(can([role], 'syllabus.apply'), false);
  for (const role of ['prorector', 'student']) assert.equal(can([role], 'syllabus.preview'), false);
  for (const role of ['admin', 'dean', 'teacher']) for (const action of ['dir.list', 'dir.save', 'dir.remove', 'import.apply']) assert.equal(can([role], action, 'topics'), false);
  assert.equal(can(['teacher'], 'dir.save', 'weekTemplate'), false);
  assert.deepEqual(listPermissions(['teacher']),
    ['journal.get', 'journal.list', 'journal.log', 'journal.saveResults', 'journal.savePair',
      'lesson.mine', 'lesson.get', 'lesson.start', 'lesson.endCheckin', 'lesson.finish',
      'schedule.mine', 'syllabus.apply', 'syllabus.attachFile', 'syllabus.dropFile', 'syllabus.file', 'syllabus.form', 'syllabus.get', 'syllabus.preview', 'syllabus.saveSection', 'syllabus.startDraft', 'syllabus.submit', 'teacher.mySubjects',
      'syllabus.decline', 'syllabus.invitations', 'syllabus.invite', 'syllabus.join', 'syllabus.leave', 'syllabus.remove', 'syllabus.withdraw',
      'work.file', 'work.get', 'work.grade', 'work.list', 'work.overview', 'work.remove', 'work.save',
      'announce.list', 'announce.remove', 'announce.save', 'ledger.addAttempt', 'ledger.closeFinal', 'ledger.closeUnit', 'ledger.get', 'ledger.list', 'ledger.saveExam',
      'repeat.close', 'repeat.get', 'repeat.list', 'repeat.saveAttempt', 'repeat.saveWorks',
      'request.create', 'request.mine', 'request.withdraw', 'stateExam.get', 'stateExam.list'].sort());
  assert.deepEqual(listPermissions(['student']), ['announce.list', 'checkin.current', 'checkin.mark', 'repeat.mine', 'schedule.mine', 'student.grades', 'student.subjects', 'syllabus.file', 'syllabus.get', 'work.dropFile', 'work.file', 'work.get', 'work.mine', 'work.submit', 'work.upload']);
  assert.equal(can(['dean'], 'topics.plan'), false);
  assert.equal(can(['student'], 'student.subjects'), true);
  assert.equal(can(['teacher'], 'student.subjects'), false);
  for (const role of ['admin', 'dean', 'prorector', 'teacher', 'student']) assert.equal(can([role], 'syllabus.get'), true);
});

test('disciplines and subjects actions', () => {
  assert.deepEqual([can(['dean'], 'dir.save', 'disciplines'), can(['prorector'], 'dir.list', 'disciplines'), can(['prorector'], 'dir.save', 'disciplines'),
    can(['teacher'], 'dir.list', 'disciplines'), can(['dean'], 'import.apply', 'disciplines')], [true, true, false, false, true]);
  assert.deepEqual([can(['dean'], 'subjects.add'), can(['prorector'], 'subjects.add'), can(['prorector'], 'subjects.overview'), can(['teacher'], 'subjects.overview')], [true, false, true, false]);
});

test('journal and scoring rights', () => {
  for (const action of ['journal.savePair', 'journal.saveResults', 'journal.missPair', 'journal.reopenPair', 'scoring.save']) assert.equal(can(['prorector'], action), false);
  for (const action of ['journal.list', 'journal.get', 'journal.savePair', 'journal.saveResults', 'journal.log']) assert.equal(can(['teacher'], action), true);
  for (const action of ['journal.missPair', 'journal.reopenPair', 'scoring.get', 'scoring.save', 'student.grades']) assert.equal(can(['teacher'], action), false);
  assert.deepEqual(listPermissions(['student']).filter((p) => p.startsWith('journal.') || p.startsWith('scoring.')), []);
  assert.equal(can(['student'], 'student.grades'), true);
  for (const action of ['journal.list', 'journal.get', 'journal.log', 'scoring.get']) assert.equal(can(['prorector'], action), true);
  for (const table of ['attendance', 'unitResults', 'changeLog']) for (const action of ['dir.list', 'dir.save', 'dir.remove', 'import.apply']) assert.equal(can(['admin'], action, table), false);
});

test('syllabus form actions by role', () => {
  const roles = ['admin', 'dean', 'prorector', 'teacher', 'student'];
  const who = (action) => roles.map((r) => can([r], action));
  for (const action of ['syllabus.startDraft', 'syllabus.saveSection', 'syllabus.submit']) assert.deepEqual(who(action), [true, true, false, true, false], action);
  assert.deepEqual([who('syllabus.form'), who('syllabus.approve'), who('syllabus.return'), who('syllabus.queue')],
    [[true, true, true, true, false], [true, true, false, false, false], [true, true, false, false, false], [true, true, true, false, false]]);
});

test('phone check-in: the pass is public, lessons are for the teacher, marks for the student, the table is closed to directories and import', () => {
  assert.equal(actionKind('checkin.pass'), 'public');
  for (const action of ['lesson.mine', 'lesson.get', 'lesson.start', 'lesson.endCheckin', 'lesson.finish']) {
    assert.equal(can(['teacher'], action), true, action);
    assert.equal(can(['dean', 'teacher'], action), true, action);
    for (const role of ['admin', 'dean', 'prorector', 'student']) assert.equal(can([role], action), false, role + ' ' + action);
  }
  for (const action of ['checkin.current', 'checkin.mark']) {
    assert.equal(can(['student'], action), true);
    for (const role of ['admin', 'dean', 'prorector', 'teacher']) assert.equal(can([role], action), false, role + ' ' + action);
  }
  for (const role of ['admin', 'dean', 'prorector', 'teacher', 'student']) {
    for (const action of ['dir.list', 'dir.save', 'dir.remove', 'import.preview', 'import.apply']) assert.equal(can([role], action, 'checkins'), false, role + ' ' + action);
  }
});

test('unit 5: the rights of work.* actions, role by role', () => {
  const roles = ['admin', 'dean', 'prorector', 'teacher', 'student'];
  const table = {
    'work.overview': ['admin', 'dean', 'prorector', 'teacher'],
    'work.list': ['admin', 'dean', 'prorector', 'teacher'],
    'work.get': roles,
    'work.save': ['teacher'],
    'work.remove': ['teacher'],
    'work.grade': ['teacher'],
    'work.mine': ['student'],
    'work.upload': ['student'],
    'work.dropFile': ['student'],
    'work.submit': ['student'],
    'work.file': roles,
  };
  for (const [action, allowed] of Object.entries(table)) {
    assert.equal(actionKind(action), 'role', action);
    for (const role of roles) assert.equal(can([role], action), allowed.includes(role), role + ' ' + action);
    assert.equal(can([], action), false, 'no roles ' + action);
  }
  for (const action of ['work.save', 'work.remove', 'work.grade']) {
    assert.equal(can(['teacher'], action), true);
    for (const role of ['admin', 'dean', 'prorector', 'student']) assert.equal(can([role], action), false, role + ' ' + action);
  }
  for (const action of ['work.mine', 'work.upload', 'work.dropFile', 'work.submit']) {
    assert.equal(can(['student'], action), true);
    for (const role of ['admin', 'dean', 'prorector', 'teacher']) assert.equal(can([role], action), false, role + ' ' + action);
  }
  for (const role of roles) assert.equal(can([role], 'work.file'), true);
  for (const action of ['work.overview', 'work.list']) assert.equal(can(['student'], action), false);
  assert.equal(can(['dean', 'teacher'], 'work.save'), true);
  assert.equal(can(['dean', 'teacher'], 'work.upload'), false);
  for (const t of ['assignments', 'submissions', 'files']) {
    for (const action of ['dir.list', 'dir.save', 'dir.remove', 'import.preview', 'import.apply']) {
      for (const role of roles) assert.equal(can([role], action, t), false, role + ' ' + action + ' ' + t);
    }
  }
  assert.deepEqual(listPermissions(['student']).filter((p) => p.startsWith('work.')), ['work.file', 'work.get', 'work.mine', 'work.submit', 'work.dropFile', 'work.upload'].sort());
  assert.deepEqual(listPermissions(['teacher']).filter((p) => p.startsWith('work.')), ['work.file', 'work.get', 'work.grade', 'work.list', 'work.overview', 'work.remove', 'work.save']);
  for (const role of ['admin', 'dean', 'prorector']) assert.deepEqual(listPermissions([role]).filter((p) => p.startsWith('work.')), ['work.file', 'work.get', 'work.list', 'work.overview']);
});

test('unit 6 actions: who may call the ledger, request, state exam and announcement actions', () => {
  const none = (action, roles) => { for (const role of roles) assert.equal(can([role], action), false, role + ' ' + action); };
  for (const action of ['ledger.closeUnit', 'ledger.closeFinal', 'ledger.saveExam', 'ledger.addAttempt', 'announce.save', 'announce.remove']) { assert.equal(can(['teacher'], action), true); none(action, ['prorector', 'student']); }
  assert.equal(can(['admin'], 'ledger.reopen'), true); none('ledger.reopen', ['dean', 'prorector', 'teacher', 'student']);
  for (const action of ['request.create', 'request.mine', 'request.withdraw']) { assert.equal(can(['teacher'], action), true); none(action, ['admin', 'dean', 'prorector', 'student']); }
  for (const action of ['request.queue', 'request.decide']) none(action, ['teacher', 'student']);
  for (const action of ['stateExam.save', 'stateExam.saveScores', 'stateExam.remove']) none(action, ['prorector', 'teacher', 'student']);
  for (const action of ['ledger.list', 'ledger.get', 'stateExam.list', 'stateExam.get']) none(action, ['student']);
  assert.deepEqual(['admin', 'dean', 'prorector', 'teacher', 'student'].map((r) => can([r], 'announce.list')), [true, true, true, true, true]);
  assert.deepEqual(listPermissions(['student']).filter((p) => /^(ledger|request|stateExam|announce)\./.test(p)), ['announce.list']);
  for (const table of ['closures', 'requests', 'announcements', 'stateExams', 'stateExamResults', 'subjectExams', 'examAttempts', 'repeats', 'repeatAttempts']) {
    for (const action of ['dir.list', 'dir.save', 'dir.remove', 'import.preview', 'import.apply']) assert.equal(can(['admin'], action, table), false, action + ' ' + table);
  }
});

test('repeat course rights', () => {
  const roles = ['admin', 'dean', 'prorector', 'teacher', 'student'];
  const row = (action) => roles.map((r) => can([r], action));
  for (const action of ['repeat.list', 'repeat.get']) assert.deepEqual(row(action), [true, true, true, true, false], action);
  for (const action of ['repeat.candidates', 'repeat.enrol', 'repeat.save', 'repeat.cancel']) assert.deepEqual(row(action), [true, true, false, false, false], action);
  for (const action of ['repeat.saveWorks', 'repeat.saveAttempt', 'repeat.close']) assert.deepEqual(row(action), [true, true, false, true, false], action);
  assert.deepEqual(row('repeat.reopen'), [true, false, false, false, false]);
  assert.deepEqual(row('repeat.mine'), [false, false, false, false, true]);
  assert.equal(can(['teacher'], 'repeat.enrol'), false);
  assert.equal(can(['dean'], 'repeat.reopen'), false);
  assert.equal(can(['student'], 'repeat.list'), false);
});

test('directory details: dir.summary and dir.card', () => {
  for (const action of ['dir.summary', 'dir.card']) {
    for (const role of ['admin', 'dean', 'prorector']) {
      for (const table of ['groups', 'rooms', 'disciplines']) assert.equal(can([role], action, table), true);
    }
    for (const table of ['students', 'staff', 'weekTemplate', undefined, ['groups']]) assert.equal(can(['dean'], action, table), false);
    assert.equal(can(['teacher'], action, 'groups'), false);
    assert.equal(can(['student'], action, 'groups'), false);
  }
  assert.ok(listPermissions(['prorector']).includes('dir.card:rooms'));
});
