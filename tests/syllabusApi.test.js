import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, INFO, HEAD, T, M, file, A, FIRST, READS } from './syllabusSetup.js';

test('syllabus upload: one syllabus of a teacher, laid over every group of that teacher', () => {
  const { publish, store, send, call, pairOf, lessons, lists, calls, writes, reset, dean, staff, ds1, sb1, sb2, sb3 } = setup();
  const pre = send('syllabus.preview', sb1, A, dean).data;
  assert.deepEqual([pre.ok, pre.applied, pre.errors, pre.warnings], [true, false, [], []]);
  assert.deepEqual(pre.summaries, [{ semester: 1, planSemester: 1, replaces: false, topics: 3, units: 1, lectureHours: 2, practiceHours: 4, controlHours: 0, pairs: 3, added: 3, changed: 0, removed: 0 }]);
  assert.deepEqual([store.list('topics').length, store.list('syllabi').length], [0, 0]);

  reset();
  const done = publish(sb1, A).data;
  assert.deepEqual([done.ok, done.applied], [true, true]);
  const { id: syllabusId, ...sheetRow } = store.list('syllabi')[0];
  const OLD = ['disciplineId', 'teacherId', 'semester', 'planSemester', 'audience', 'credits', 'totalHours', 'classHours', 'selfHours', 'updated'];
  assert.deepEqual(Object.fromEntries(OLD.map((k) => [k, sheetRow[k]])), { disciplineId: ds1, teacherId: staff.teacher1, semester: 1, planSemester: 1, audience: 'Сестринское дело', credits: 1, totalHours: 10, classHours: 6, selfHours: 4, updated: '2026-08-31' });
  // a row of the file is one lesson of one kind; the first lesson of a row keeps its description, the rest has none
  assert.deepEqual(store.list('topics').map((t) => [t.syllabusId === syllabusId, t.order, t.lessonKind, t.name, t.hours, t.description]),
    [[true, 1, 'lecture', 'Введение', 2, 'О теме Введение'], [true, 2, 'practice', 'Введение', 2, ''], [true, 3, 'practice', 'Практикум', 2, 'О теме Практикум'], [true, 4, 'control', '', 0, '']]);
  assert.deepEqual([sheetRow.status, sheetRow.version, sheetRow.manualOrder], ['approved', 1, true]);
  // у каждой группы свои даты, темы одни и те же; все группы записаны одной пачкой
  assert.deepEqual(lessons(sb1), [['2026-09-01', ...FIRST[0]], ['2026-09-08', ...FIRST[1]]]);
  assert.deepEqual(lessons(sb3), [['2026-09-02', ...FIRST[0]], ['2026-09-09', ...FIRST[1]]]);
  assert.equal(pairOf(sb1, '2026-09-01').topicId, pairOf(sb3, '2026-09-02').topicId);
  assert.deepEqual(lessons(sb2).map((x) => x[1]), ['', '']);                                  // другая дисциплина не тронута
  assert.deepEqual(lists, READS);
  assert.deepEqual(writes, { 'insertMany:syllabi': 1, 'insertMany:topics': 1, 'updateMany:pairs': 1 });
  assert.deepEqual([calls.get, calls.insert || 0, calls.update || 0, calls.remove || 0], [1, 0, 0, 0]);  // get — только проверка токена

  // тот же силлабус загружают со страницы другой группы: строка «Силлабусов» по-прежнему одна, пишется только она
  reset();
  const again = publish(sb3, A).data;
  const [sum] = again.summaries;
  assert.deepEqual([again.applied, sum.replaces, sum.added + sum.changed + sum.removed, store.list('syllabi').length], [true, true, 0, 1]);
  assert.deepEqual([lists, writes, calls.update || 0, calls.insert || 0], [READS, { 'updateMany:syllabi': 1 }, 0, 0]);

  // строка добавлена, строка ушла, порядок сдвинулся — по одной пачке каждого вида на все группы
  reset();
  assert.equal(publish(sb1, file([T('Новая тема', 2, ''), T('Введение', 2, 2), M])).data.applied, true);
  assert.deepEqual(writes, { 'updateMany:syllabi': 1, 'removeMany:topics': 1, 'updateMany:topics': 1, 'insertMany:topics': 1, 'updateMany:pairs': 1 });
  assert.deepEqual([calls.get, calls.update || 0, calls.insert || 0, calls.remove || 0], [1, 0, 0, 0]);
  assert.deepEqual([lessons(sb1), lessons(sb3)], [[['2026-09-01', 'Новая тема', 'lecture', 1], ['2026-09-08', 'Введение', 'lecture', 1]],
    [['2026-09-02', 'Новая тема', 'lecture', 1], ['2026-09-09', 'Введение', 'lecture', 1]]]);

  // отмена пары в одной группе другую не трогает
  call('schedule.cancelPair', { id: pairOf(sb3, '2026-09-02').id }, dean);
  assert.deepEqual([lessons(sb3), lessons(sb1)[0]], [[['2026-09-02', '', '', null], ['2026-09-09', 'Новая тема', 'lecture', 1]], ['2026-09-01', 'Новая тема', 'lecture', 1]]);

  // проверка файла читает шесть листов и ничего не пишет
  reset();
  send('syllabus.preview', sb1, A, dean);
  assert.deepEqual([lists, writes, calls.update || 0, calls.insert || 0], [{ subjects: 1, staff: 1, groups: 1, syllabi: 1, topics: 1, pairs: 1 }, {}, 0, 0]);

  // перенос строки в описании доходит до листа «Темы» как есть: строки тем пишутся без normalizeRow — и изменённые (updateMany), и новая (insertMany)
  const described = [['Новая тема', 'Первая строка\nвторая строка'], ['Введение', 'Цель:\nзнать IT'], ['Сети', 'Схема:\nзвезда']];
  assert.equal(publish(sb1, file([...described.map(([name, text], i) => [1, '', name, 2, i === 1 ? 2 : '', '', text]), M])).data.applied, true);
  assert.deepEqual(described.map(([name]) => store.list('topics').find((t) => t.name === name).description), described.map(([, text]) => text));
});

test('a module without hours marks the last pair of its unit; a module with hours is a pair of its own', () => {
  const { publish, send, call, dean, g1, sb1 } = setup();
  publish(sb1, file([T('Введение', 2, ''), T('Практикум', '', 2), M]));
  const view = () => call('schedule.list', { from: '2026-09-01', to: '2026-09-11', groupId: g1 }, dean).data.pairs.map((p) => [p.topic.name, p.topic.kind, p.topic.lessonType, p.topic.controls]);
  assert.deepEqual(view(), [['Введение', 'topic', 'lecture', []], ['Практикум', 'topic', 'practice', [{ name: '', unit: 1 }]]]);
  publish(sb1, file([T('Введение', 2, ''), [1, '', 'Сдача модуля', '', 2, 'модуль', '']]));
  assert.deepEqual(view(), [['Введение', 'topic', 'lecture', []], ['Сдача модуля', 'control', 'control', []]]);
});

test('syllabus upload: a file with an error writes nothing', () => {               // Review Focus 14
  const { publish, send, snapshot, writes, dean, sb1 } = setup();
  publish(sb1, A);
  const before = snapshot();
  const bad = publish(sb1, file([T('Введение', 3, '')])).data;
  assert.deepEqual([bad.ok, bad.applied, bad.summaries], [false, false, []]);
  assert.deepEqual(bad.errors, [{ sheet: 'plan', row: 2, field: 'lectureHours', code: 'bad_hours' }]);
  assert.equal(snapshot(), before);
});

test('syllabus upload: held pairs keep their topic, whichever group held them', () => {      // Review Focus 13
  const { publish, store, send, pairOf, lessons, snapshot, dean, sb1, sb3 } = setup();
  publish(sb1, A);
  const first = pairOf(sb3, '2026-09-02');                                          // проведена в группе 02-1
  store.update('pairs', first.id, { status: 'closed' });
  // порядок сдвинулся: проведённая пара держит «Введение», остальные получают первое свободное занятие
  assert.equal(publish(sb1, file([T('Новая тема', 2, ''), T('Введение', 2, 2), T('Практикум', '', 2), M])).data.applied, true);
  assert.deepEqual(lessons(sb3), [['2026-09-02', 'Введение', 'lecture', 1], ['2026-09-09', 'Новая тема', 'lecture', 1]]);
  assert.deepEqual(lessons(sb1), [['2026-09-01', 'Новая тема', 'lecture', 1], ['2026-09-08', 'Введение', 'lecture', 1]]);
  assert.equal(store.get('pairs', first.id).topicId, first.topicId);
  // темы проведённой пары нет в файле; у неё не осталось лекционных часов — ничего не записано
  const before = snapshot();
  for (const [rows, code] of [[[T('Практикум', '', 2), M], 'held_missing'], [[T('Введение', '', 2), M], 'held_hours']]) {
    const refused = publish(sb1, file(rows)).data;
    assert.deepEqual([refused.ok, refused.applied, refused.errors.map((e) => e.code)], [false, false, [code]]);
    assert.equal(snapshot(), before);
  }
  // переименование на том же месте — замечание, тема проведённой пары получает новое название
  // the file has 8 classroom hours: the declared numbers say so, so the only remark is the rename
  const info8 = INFO.map(([title, value]) => [title, title === 'Всего часов' ? 12 : title === 'Аудиторных часов' ? 8 : value]);
  const renamed = publish(sb1, file([T('Новая тема', 2, ''), T('Введение в предмет', 2, 2), T('Практикум', '', 2), M], info8)).data;
  assert.deepEqual([renamed.applied, renamed.warnings], [true, [{ code: 'held_renamed', order: 2, from: 'Введение', to: 'Введение в предмет', date: '2026-09-02' }]]);
  assert.deepEqual(lessons(sb3)[0], ['2026-09-02', 'Введение в предмет', 'lecture', 1]);
});

test('a group follows the syllabus of its own teacher', () => {                   // Review Focus 17
  const { publish, store, send, call, pairOf, lessons, lists, writes, reset, dean, staff, sb1, sb3 } = setup();
  publish(sb1, A);
  // разовая замена на паре тему не меняет
  call('schedule.changePair', { id: pairOf(sb1, '2026-09-08').id, teacherId: staff.teacher2 }, dean);
  assert.deepEqual(lessons(sb1), [['2026-09-01', ...FIRST[0]], ['2026-09-08', ...FIRST[1]]]);
  // группа 02-1 переходит к teacher2; её первая пара уже проведена по силлабусу teacher1
  store.update('pairs', pairOf(sb3, '2026-09-02').id, { status: 'closed' });
  reset();
  assert.equal(call('dir.save', { table: 'subjects', row: { id: sb3, teacherId: staff.teacher2 } }, dean).ok, true);
  assert.deepEqual(lessons(sb3), [['2026-09-02', ...FIRST[0]], ['2026-09-09', '', '', null]]);          // у teacher2 силлабуса нет: пара без темы
  for (const [table, n] of Object.entries(lists)) assert.equal(n, 1, table);
  assert.ok((writes['updateMany:pairs'] || 0) <= 1);
  assert.deepEqual(lessons(sb1), [['2026-09-01', ...FIRST[0]], ['2026-09-08', ...FIRST[1]]]);            // группа 01-1 не тронута
  // teacher2 получает свой силлабус: он продолжается со второго занятия (одна пара уже проведена)
  assert.equal(publish(sb3, file([T('Основы', 2, ''), T('Сети', 2, ''), M])).data.applied, true);
  assert.equal(store.list('syllabi').length, 2);
  assert.deepEqual(lessons(sb3), [['2026-09-02', ...FIRST[0]], ['2026-09-09', 'Сети', 'lecture', 1]]);
  assert.deepEqual(lessons(sb1), [['2026-09-01', ...FIRST[0]], ['2026-09-08', ...FIRST[1]]]);
  // тему, проведённую в группе 02-1, нельзя убрать из силлабуса teacher1, хотя группа уже у другого преподавателя
  assert.deepEqual(publish(sb1, file([T('Практикум', '', 2), M])).data.errors.map((e) => e.code), ['held_missing']);
});

test('syllabus upload: semesters as in the curriculum; the spring file leaves the autumn one alone; the switch lays it', () => {   // Review Focus 18
  const { publish, store, send, call, lessons, writes, reset, dean, sb1, sb3, S } = setup();
  publish(sb1, A);
  reset();
  assert.equal(publish(sb1, file([T('Таблицы', 2, ''), M], [['Семестр', 4]])).data.applied, true);      // 4-й семестр по плану — весенний
  assert.equal(writes['updateMany:pairs'] || 0, 0);
  assert.deepEqual([store.list('syllabi').map((s) => [s.semester, s.planSemester]), store.list('topics').length], [[[1, 1], [2, 4]], 6]);
  assert.deepEqual(lessons(sb1), [['2026-09-01', ...FIRST[0]], ['2026-09-08', ...FIRST[1]]]);
  call('settings.save', { settings: { ...S, semester: 2 } }, dean);
  assert.deepEqual(lessons(sb1), [['2026-09-01', 'Таблицы', 'lecture', 1], ['2026-09-08', '', '', null]]);
  assert.deepEqual(lessons(sb3), [['2026-09-02', 'Таблицы', 'lecture', 1], ['2026-09-09', '', '', null]]);
});

test('syllabus upload: one file for the whole year writes both semesters in one batch', () => {
  const { publish, store, send, lessons, writes, reset, dean, sb1 } = setup();
  const yearFile = [{ name: 'Сведения', cells: [['Семестр', '1-2']] },
    { name: 'Тематический план', cells: [['Семестр', ...HEAD], [1, ...T('Осень', 2, '')], [2, ...T('Весна', 2, '')]] }];
  reset();
  const done = publish(sb1, yearFile).data;
  assert.deepEqual([done.applied, done.summaries.map((s) => [s.semester, s.planSemester, s.pairs])], [true, [[1, 1, 1], [2, 2, 1]]]);
  assert.deepEqual([writes['insertMany:syllabi'], writes['insertMany:topics'], store.list('syllabi').length], [1, 1, 2]);
  assert.deepEqual(lessons(sb1), [['2026-09-01', 'Осень', 'lecture', 1], ['2026-09-08', '', '', null]]);
});

test('syllabus upload: only the deanery and the administrator; bad requests; the old ways are closed', () => {   // Review Focus 15
  const { publish, store, send, call, snapshot, dean, prorector, teacher1, staff, g1, sb1 } = setup();
  for (const token of [teacher1, prorector]) {
    for (const action of ['syllabus.preview', 'syllabus.apply']) assert.deepEqual(send(action, sb1, A, token).error, { code: 'forbidden' });
  }
  assert.deepEqual(publish('sb_nope', A).error, { code: 'not_found' });
  assert.deepEqual(publish(` ${sb1} `, A).error, { code: 'not_found' });
  for (const subjectId of [[sb1], 5, '', null]) assert.deepEqual(publish(subjectId, A).error, { code: 'bad_request' });
  for (const sheets of ['x', [], Array(11).fill(A[0]), [{ name: 5, cells: [] }], [{ name: 'Сведения', cells: 'x' }], [{ name: 'Сведения', cells: [5] }]]) {
    assert.deepEqual(publish(sb1, sheets).error, { code: 'bad_request' });
  }
  // a cell is text, a number, a boolean or empty: an object or an array would be stored as «[object Object]» or «a,b»
  const before = snapshot();
  for (const bad of [{ a: 1 }, ['a', 'b'], [], [[1]]]) {
    const cells = [{ name: 'Сведения', cells: [['Семестр', 1]] }, { name: 'Тематический план', cells: [HEAD, [1, '', bad, 2, '', '', '']] }];
    for (const action of ['syllabus.preview', 'syllabus.apply']) assert.deepEqual(send(action, sb1, cells, dean).error, { code: 'bad_request' });
  }
  assert.equal(snapshot(), before);
  assert.equal(send('syllabus.preview', sb1, [{ name: 'Сведения', cells: [['Семестр', 1, true, null]] }, A[1]], dean).ok, true);   // boolean and empty cells are cells
  const orphan = store.insert('subjects', { name: 'Старый предмет', groupId: g1, teacherId: staff.teacher1, scheme: 'A' }).id;      // без дисциплины
  assert.deepEqual(publish(orphan, A).error, { code: 'invalid', fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  assert.equal(store.list('topics').length, 0);
  const topicRow = { syllabusId: 'sy_x', order: 1, unit: 1, name: 'Мимо файла', lessonKind: 'lecture', hours: 2 };
  for (const token of [dean, teacher1]) assert.deepEqual(call('dir.save', { table: 'topics', row: topicRow }, token).error, { code: 'forbidden' });
  assert.deepEqual(call('dir.list', { table: 'topics' }, dean).error, { code: 'forbidden' });
  assert.deepEqual(call('import.apply', { table: 'topics', cells: [['Предмет']] }, dean).error, { code: 'forbidden' });
  assert.deepEqual(call('syllabus.apply', { subjectId: sb1, cells: [['Семестр']] }, dean).error, { code: 'bad_request' });   // прежний формат
});

test('a new teacher of a group takes its future pairs of the old teacher, moved ones too, in the same batch as the lessons; substituted, held, past, cancelled and busy pairs keep theirs', () => {   // I1, N2
  const { store, call, pairOf, lists, writes, calls, reset, dean, teacher1, teacher2, staff, g2, sb1, sb3, S } = setup();
  call('settings.save', { settings: { ...S, semesterEnd: '2026-10-09' } }, dean);
  call('schedule.generate', {}, dean);                                                     // sb3 (02-1, teacher1): Wednesdays 09-02 … 10-07
  const past = store.insert('pairs', { date: '2026-08-26', slot: 1, startTime: '08:00', groupId: g2, subjectId: sb3, teacherId: staff.teacher1, roomId: '',
    topicId: '', lessonType: '', part: null, status: 'planned', planDate: '2026-08-26', planSlot: 1, changed: false, note: '' }).id;
  const ok = (action, data) => assert.equal(call(action, data, dean).ok, true, action);
  store.update('pairs', pairOf(sb3, '2026-09-02').id, { status: 'closed' });                               // held
  ok('schedule.changePair', { id: pairOf(sb3, '2026-09-09').id, teacherId: staff.dean });                    // a one-off substitution
  ok('schedule.changePair', { id: pairOf(sb3, '2026-09-16').id, date: '2026-09-17' });                       // moved by hand, still teacher1
  // teacher2 is busy on 09-24 at pair 1 (a pair of 01-1 moved there and given to teacher2); the 09-23 pair of 02-1 is moved into that slot
  ok('schedule.changePair', { id: pairOf(sb1, '2026-09-22').id, date: '2026-09-24', teacherId: staff.teacher2 });
  ok('schedule.changePair', { id: pairOf(sb3, '2026-09-23').id, date: '2026-09-24' });
  ok('schedule.cancelPair', { id: pairOf(sb3, '2026-10-07').id });                                          // cancelled

  reset();
  const saved = call('dir.save', { table: 'subjects', row: { id: sb3, teacherId: staff.teacher2 } }, dean);
  assert.deepEqual([saved.ok, saved.data.row.teacherId, saved.data.skippedBusy], [true, staff.teacher2, 1]);
  const DATES = ['2026-08-26', '2026-09-02', '2026-09-09', '2026-09-17', '2026-09-24', '2026-09-30', '2026-10-07'];
  const teacherOf = (date) => store.list('pairs').find((p) => p.subjectId === sb3 && p.date === date).teacherId;
  assert.deepEqual(DATES.map(teacherOf), [staff.teacher1, staff.teacher1, staff.dean, staff.teacher2, staff.teacher1, staff.teacher2, staff.teacher1]);
  assert.equal(store.get('pairs', past).teacherId, staff.teacher1);
  // one read of every sheet, one batch for the pairs: the teacher and the lessons together
  for (const [table, n] of Object.entries(lists)) assert.equal(n, 1, table);
  assert.deepEqual([writes['updateMany:pairs'], calls.update], [1, 1]);

  // «Моё расписание»: the new teacher has the moved pair, without the «Замена» mark; the old one no longer has the future ones
  const week = (token, from) => call('schedule.mine', { from }, token).data.pairs.filter((p) => p.subjectId === sb3);
  assert.deepEqual(week(teacher2, '2026-09-14').map((p) => [p.date, p.groupName, p.substitution, p.moved]), [['2026-09-17', '02-1', false, true]]);
  assert.deepEqual(week(teacher2, '2026-09-28').map((p) => [p.date, p.substitution]), [['2026-09-30', false]]);
  assert.deepEqual(week(teacher1, '2026-09-28'), []);
  assert.deepEqual(week(teacher1, '2026-10-05').map((p) => [p.date, p.status]), [['2026-10-07', 'cancelled']]);   // the cancelled pair stays as it was
  assert.deepEqual(call('schedule.list', { from: '2026-09-28', groupId: g2 }, dean).data.pairs.filter((p) => p.subjectId === sb3 && p.status === 'planned')
    .map((p) => [p.teacherName, p.substitution]), [['teacher2', false]]);

  // back to the first teacher: the pairs of teacher2 follow again, moved one included; the substitute keeps his pair
  assert.equal(call('dir.save', { table: 'subjects', row: { id: sb3, teacherId: staff.teacher1 } }, dean).ok, true);
  assert.deepEqual(DATES.slice(2, 6).map(teacherOf), [staff.dean, staff.teacher1, staff.teacher1, staff.teacher1]);
});

test('the check window says when a file of another curriculum semester replaces the stored one, and in which groups', () => {   // I3
  const { publish, send, lists, reset, dean, sb1, sb3 } = setup();
  publish(sb1, A);
  reset();
  const third = send('syllabus.preview', sb3, file([T('Второй курс', 2, ''), M], [['Семестр', '3 семестр']]), dean).data;
  assert.deepEqual([third.ok, third.warnings.filter((w) => w.code === 'semester_replaces')], [true, [{ code: 'semester_replaces', stored: 1, file: 3, groups: ['01-1', '02-1'] }]]);
  const { settings, ...previewReads } = READS;                                     // the check reads every sheet once; the settings only when it writes
  assert.deepEqual(lists, previewReads);
});

test('a discipline or a person with a stored syllabus cannot be deleted: no orphan rows in «Силлабусы» and «Темы»', () => {   // M7
  const { publish, store, send, call, dean, staff, ds2, sb2 } = setup();
  assert.equal(publish(sb2, file([T('Анатомия 1', 2, '')])).data.applied, true);
  for (const p of store.list('pairs').filter((p) => p.subjectId === sb2)) store.remove('pairs', p.id);
  for (const w of store.list('weekTemplate').filter((w) => w.subjectId === sb2)) store.remove('weekTemplate', w.id);
  assert.equal(call('dir.remove', { table: 'subjects', id: sb2 }, dean).ok, true);
  const admin = store.insert('staff', { fullName: 'adm', login: 'adm', passwordHash: store.list('staff')[0].passwordHash, roles: 'admin', lang: 'ru', mustChangePassword: false, active: true });
  const token = call('auth.login', { login: admin.login, password: 'secret12' }).data.token;
  assert.deepEqual(call('dir.remove', { table: 'disciplines', id: ds2 }, dean).error, { code: 'in_use' });
  assert.deepEqual(call('dir.remove', { table: 'staff', id: staff.teacher2 }, token).error, { code: 'in_use' });
  assert.deepEqual([store.list('syllabi').length, store.list('topics').length], [1, 1]);
});

test('only the approved version is laid over the pairs; the file writes the approved version 1 and keeps the number of an existing one', () => {
  const { publish, store, call, lessons, dean, sb1 } = setup();
  publish(sb1, A);
  assert.deepEqual(lessons(sb1), [['2026-09-01', ...FIRST[0]], ['2026-09-08', ...FIRST[1]]]);      // the pairs got the same lessons as before the change
  store.update('syllabi', store.list('syllabi')[0].id, { version: 4 });
  publish(sb1, file([T('Введение', 2, 2), M]));
  assert.deepEqual([store.list('syllabi')[0].status, store.list('syllabi')[0].version], ['approved', 4]);
  // a version that is not approved does not lie on the pairs
  store.update('syllabi', store.list('syllabi')[0].id, { status: 'draft' });
  call('schedule.generate', {}, dean);
  assert.deepEqual(lessons(sb1).map((x) => x[1]), ['', '']);
});
