import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from '../core/schema.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createSqliteStore, ensureTables, openDatabase } from '../backend/store/sqliteStore.js';
import { applyLinesUpgrade } from '../backend/linesUpgrade.js';
import { main } from '../backend/node/server.js';
import { startDevServer } from '../dev/server.js';
import { setup, failingOn } from './linesSetup.js';
import { openBase } from '../backend/node/base.js';
import { envOf, keep, tempBase, tempDir } from './serverSetup.js';

const code = (r) => r.error && r.error.code;
const old = (s, key, semester, status, version, over = {}) => s.store.insert('syllabi', {
  disciplineId: s.ds1, teacherId: key === null ? '' : s.ids[key], semester, status, version, planSemester: semester, course: 1, ...over,
});

// ds1: t1 - versions 1 (archived), 2 (approved), 3 (draft) of the autumn and 1 (approved) of the spring; t2 - version 1 (approved) of the autumn; a row without a teacher
function oldVersions(s) {
  old(s, 't1', 1, 'archived', 1);
  old(s, 't1', 1, 'approved', 2);
  old(s, 't1', 1, 'draft', 3);
  old(s, 't1', 2, 'approved', 1);
  old(s, 't2', 1, 'approved', 1);
  old(s, null, 1, 'approved', 9);
}

test('applyLinesUpgrade: the old versions go to the lines of their teachers, the rest is not touched, a second run writes nothing', () => {
  const s = setup();
  oldVersions(s);
  const before = s.snapshot();
  assert.deepEqual(applyLinesUpgrade(s.store, s.platform), { lines: 3, skipped: 1 });
  const lines = s.store.list('syllabusLines');
  assert.deepEqual(lines.map((l) => [l.semester, l.authorId, l.createdBy]), [[1, s.ids.t1, ''], [2, s.ids.t1, ''], [1, s.ids.t2, '']]);
  assert.deepEqual(s.store.list('syllabusMembers').map((x) => x.state), ['joined', 'joined', 'joined']);
  assert.deepEqual(s.store.list('syllabusMembers').map((x) => [x.byId, x.invitedAt, x.endedAt, x.endedBy, x.joinedAt !== '']), Array(3).fill(['', '', '', '', true]));
  assert.deepEqual(s.store.list('syllabusLines').map((l) => l.createdAt !== ''), [true, true, true]);
  const strip = (rows) => rows.map(({ lineId, ...rest }) => rest);
  assert.deepEqual(strip(s.store.list('syllabi')), strip(before.syllabi));
  assert.equal(s.store.list('syllabi').filter((v) => v.lineId === '').length, 1);
  assert.deepEqual(s.store.list('syllabi').filter((v) => v.teacherId === s.ids.t1 && v.semester === 1).map((v) => v.lineId), Array(3).fill(lines[0].id));
  for (const name of Object.keys(before)) if (!['syllabi', 'syllabusLines', 'syllabusMembers'].includes(name)) assert.deepEqual(s.snapshot()[name], before[name], name);
  assert.deepEqual(s.oneJoined(), []);
  s.spy.reset();
  assert.deepEqual([applyLinesUpgrade(s.spied, s.platform), s.spy.writes], [{ lines: 0, skipped: 1 }, {}]);
});

test('applyLinesUpgrade: with no version without a line only the versions are read', () => {
  const s = setup();
  s.spy.reset();
  assert.deepEqual([applyLinesUpgrade(s.spied, s.platform), s.spy.lists, s.spy.writes], [{ lines: 0, skipped: 0 }, { syllabi: 1 }, {}]);
  oldVersions(s);
  applyLinesUpgrade(s.store, s.platform);
  s.spy.reset();
  applyLinesUpgrade(s.spied, s.platform);
  assert.deepEqual(s.spy.lists, { syllabi: 1, syllabusLines: 1, syllabusMembers: 1 });
});

test('applyLinesUpgrade: lines are written first, then the members, then the versions (one batch each)', () => {
  const s = setup();
  oldVersions(s);
  const order = [];
  const wrapped = { ...s.store };
  for (const m of ['insertMany', 'updateMany']) wrapped[m] = (table, rows) => { order.push(`${m}:${table}`); return s.store[m](table, rows); };
  applyLinesUpgrade(wrapped, s.platform);
  assert.deepEqual(order, ['insertMany:syllabusLines', 'insertMany:syllabusMembers', 'updateMany:syllabi']);
});

test('applyLinesUpgrade: versions that the old code wrote after a rollback join the line of their teacher, or a history line', () => {
  const s = setup();
  oldVersions(s);
  applyLinesUpgrade(s.store, s.platform);
  const line1 = s.lineOf('t1');
  // the old code wrote a version by the key of t1: it goes to his line, no new line
  const again = old(s, 't1', 1, 'draft', 4);
  assert.equal(applyLinesUpgrade(s.store, s.platform).lines, 0);
  assert.equal(s.store.list('syllabi').find((v) => v.id === again.id).lineId, line1.id);
  // t2 now leads the line of t1; his own line is left; the old code wrote a version by his key
  const own = s.lineOf('t2');
  const member = s.store.list('syllabusMembers').find((x) => x.lineId === own.id);
  s.store.update('syllabusMembers', member.id, { state: 'left', endedAt: '2026-10-01 10:00:00' });
  s.share(line1.id, 't2');
  const rolled = old(s, 't2', 1, 'draft', 2);
  assert.equal(applyLinesUpgrade(s.store, s.platform).lines, 1);
  const home = s.store.list('syllabi').find((v) => v.id === rolled.id);
  const made = s.store.list('syllabusLines').find((l) => l.id === home.lineId);
  assert.deepEqual([made.id !== line1.id, made.authorId, made.semester], [true, s.ids.t2, 1]);
  assert.deepEqual(s.store.list('syllabusMembers').filter((x) => x.lineId === made.id).map((x) => [x.teacherId, x.state]), [[s.ids.t2, 'left']]);
  assert.deepEqual(s.oneJoined(), []);
});

test('applyLinesUpgrade: a second approved version does not appear on a shared line', () => {
  const s = setup();
  old(s, 't1', 1, 'approved', 1);
  applyLinesUpgrade(s.store, s.platform);
  const line = s.lineOf('t1');
  s.share(line.id, 't2');
  s.store.update('syllabusLines', line.id, { authorId: s.ids.t2 });
  const stray = old(s, 't2', 1, 'approved', 2);
  assert.equal(applyLinesUpgrade(s.store, s.platform).lines, 1);
  const home = s.store.list('syllabi').find((v) => v.id === stray.id);
  assert.notEqual(home.lineId, line.id);
  assert.equal(s.store.list('syllabi').filter((v) => v.lineId === line.id && v.status === 'approved').length, 1);
  assert.deepEqual(s.store.list('syllabusMembers').filter((x) => x.lineId === home.lineId).map((x) => x.state), ['left']);
  assert.deepEqual(s.oneJoined(), []);
});

test('applyLinesUpgrade on SQLite is one transaction: a failed write leaves no lines and no members', (t) => {
  const dir = tempDir(t);
  const db = openDatabase(path.join(dir, 'lines.sqlite'));
  keep(t, { close: () => db.close() });
  ensureTables(SCHEMA, db);
  const platform = createNodePlatform({ now: () => Date.UTC(2026, 9, 1, 6), secret: 'test-secret' });
  const store = createSqliteStore(SCHEMA, platform, db);
  store.insert('syllabi', { disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, status: 'approved', version: 1 });
  assert.throws(() => applyLinesUpgrade(failingOn(store, 'updateMany', 'syllabi'), platform), /boom/);
  assert.deepEqual([store.list('syllabusLines').length, store.list('syllabusMembers').length, store.list('syllabi')[0].lineId], [0, 0, '']);
  assert.deepEqual(applyLinesUpgrade(store, platform), { lines: 1, skipped: 0 });
  assert.equal(store.list('syllabi')[0].lineId, store.list('syllabusLines')[0].id);
});

test('the start of the server makes the lines once and says so; the second start says nothing', async (t) => {
  const { config } = tempBase(t);
  const base = keep(t, openBase(config));
  base.store.insert('syllabi', { disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, status: 'approved', version: 1 });
  base.store.insert('syllabi', { disciplineId: 'ds_1', teacherId: '', semester: 1, status: 'draft', version: 2 });
  for (const table of ['syllabusLines', 'syllabusMembers']) base.db.exec(`DROP TABLE "${table}"`);
  for (const column of ['lineId', 'sourceId']) base.db.exec(`ALTER TABLE "syllabi" DROP COLUMN "${column}"`);
  base.close();
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {} }));
  const log = () => fs.readFileSync(config.logFile, 'utf8');
  assert.match(log(), /base upgraded: 2 tables made, 2 columns added/);
  assert.match(log(), /syllabus lines made: 1, rows without a line: 1/);
  assert.equal(run.base.store.list('syllabusLines').length, 1);
  await run.stop();
  const size = log().length;
  const second = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {} }));
  assert.equal(second.code, 0);
  assert.doesNotMatch(log().slice(size), /base upgraded|syllabus lines made/);
});

test('the stand: an old file gets its lines and a copy beside it; a fresh stand gets no copy', async (t) => {
  const dir = tempDir(t);
  const siteDir = path.join(dir, 'site');
  fs.mkdirSync(siteDir);
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<title>x</title>');
  const dataFile = path.join(dir, 'db.json');
  const said = [];
  const log = console.log;
  console.log = (line) => said.push(String(line));
  try {
    await (await startDevServer({ port: 0, dataFile, siteDir })).close();
    const fresh = fs.readFileSync(dataFile, 'utf8');
    assert.equal(fs.existsSync(dataFile + '.before-shared-syllabus.bak'), false);
    // the same file as the old code left it: no line anywhere
    const data = JSON.parse(fresh);
    const text = JSON.stringify({ ...data, syllabi: data.syllabi.map((v) => ({ ...v, lineId: '', sourceId: '' })), syllabusLines: [], syllabusMembers: [] });
    fs.writeFileSync(dataFile, text);
    said.length = 0;
    await (await startDevServer({ port: 0, dataFile, siteDir })).close();
    assert.equal(fs.readFileSync(dataFile + '.before-shared-syllabus.bak', 'utf8'), text);
    const after = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.deepEqual([after.syllabi.every((v) => v.lineId !== ''), after.syllabusLines.length > 0, said.some((l) => /^syllabus lines made: \d+/.test(l))], [true, true, true]);
    // the copy is kept as it is on the next start
    await (await startDevServer({ port: 0, dataFile, siteDir })).close();
    assert.equal(fs.readFileSync(dataFile + '.before-shared-syllabus.bak', 'utf8'), text);
  } finally {
    console.log = log;
  }
});

test('startDraft of a teacher without a line makes the line, the member and the first version', () => {
  const s = setup();
  const done = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.data.created, true);
  const [line] = s.store.list('syllabusLines');
  assert.deepEqual([s.store.list('syllabusLines').length, line.disciplineId, line.semester, line.authorId, line.createdBy, line.createdAt !== ''], [1, s.ds1, 1, s.ids.t1, s.ids.t1, true]);
  const [member] = s.store.list('syllabusMembers');
  assert.deepEqual([s.store.list('syllabusMembers').length, member.lineId, member.teacherId, member.state, member.byId, member.joinedAt !== '', member.disciplineId, member.semester],
    [1, line.id, s.ids.t1, 'joined', s.ids.t1, true, s.ds1, 1]);
  const [version] = s.store.list('syllabi');
  assert.deepEqual([version.id, version.lineId, version.sourceId, version.version, version.teacherId, version.disciplineId, version.semester],
    [done.data.syllabusId, line.id, '', 1, s.ids.t1, s.ds1, 1]);
  assert.deepEqual(s.oneJoined(), []);
  // a second click: the same version, nothing new
  const before = s.snapshot();
  assert.deepEqual(s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data, { syllabusId: version.id, created: false });
  assert.deepEqual(s.snapshot(), before);
  // the other half of the year is another line
  assert.equal(s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 2 }, s.t.t1).data.created, true);
  assert.deepEqual([s.store.list('syllabusLines').map((l) => l.semester), s.oneJoined()], [[1, 2], []]);
});

test('startDraft by the deanery for a teacher: the author of the line is the teacher, the one who made it is the deanery', () => {
  const s = setup();
  assert.equal(s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.dean).data.created, true);
  const [line] = s.store.list('syllabusLines');
  const [member] = s.store.list('syllabusMembers');
  const [version] = s.store.list('syllabi');
  assert.deepEqual([line.authorId, line.createdBy, member.teacherId, member.byId, version.teacherId, version.editedBy], [s.ids.t2, s.ids.dean, s.ids.t2, s.ids.dean, s.ids.t2, s.ids.dean]);
  assert.deepEqual(s.oneJoined(), []);
});

test('startDraft over an approved version: the number goes on, sourceId is the approved one, the sections are copied', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  const approved = s.store.list('syllabi').find((v) => v.status === 'approved');
  assert.deepEqual([approved.lineId !== '', approved.teacherId, s.store.list('syllabusLines').length, s.store.list('syllabusMembers').length], [true, s.ids.t1, 1, 1]);
  const done = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1);
  const draft = s.store.list('syllabi').find((v) => v.id === done.data.syllabusId);
  assert.deepEqual([draft.sourceId, draft.version, draft.lineId, draft.teacherId, s.store.list('syllabusLines').length], [approved.id, approved.version + 1, approved.lineId, s.ids.t1, 1]);
  assert.equal(s.store.list('topics').filter((x) => x.syllabusId === draft.id).length, s.store.list('topics').filter((x) => x.syllabusId === approved.id).length);
  assert.deepEqual(s.oneJoined(), []);
});

test('syllabus.apply of the administrator for a teacher without a line: the line is his; the version names the teacher of the subject', () => {
  const s = setup();
  const done = s.call('syllabus.apply', { subjectId: s.sb3, sheets: s.FILE_A }, s.t.admin);
  assert.equal(done.data.applied, true, JSON.stringify(done));
  const [line] = s.store.list('syllabusLines');
  const [member] = s.store.list('syllabusMembers');
  assert.deepEqual([s.store.list('syllabusLines').length, line.authorId, line.createdBy, member.teacherId, member.byId, member.state], [1, s.ids.t3, s.ids.admin, s.ids.t3, s.ids.admin, 'joined']);
  const [version] = s.store.list('syllabi');
  assert.deepEqual([version.teacherId, version.lineId, version.sourceId, version.version], [s.ids.t3, line.id, '', 1]);
  // the file again: the open version is filled, no new line, no new version
  assert.equal(s.call('syllabus.apply', { subjectId: s.sb3, sheets: s.FILE_B }, s.t.admin).data.applied, true);
  assert.deepEqual([s.store.list('syllabi').length, s.store.list('syllabusLines').length, s.store.list('syllabusMembers').length, s.store.list('syllabi')[0].teacherId], [1, 1, 1, s.ids.t3]);
  assert.deepEqual(s.oneJoined(), []);
});

test('syllabus.apply of a file with both halves makes a line for each half', () => {
  const s = setup();
  const sheets = s.FILE_A.map((sheet) => (sheet.name === 'Сведения' ? { ...sheet, cells: sheet.cells.map((row) => (row[0] === 'Семестр' ? ['Семестр', 1] : row)) } : sheet));
  assert.equal(s.call('syllabus.apply', { subjectId: s.sb1, sheets }, s.t.t1).data.applied, true);
  assert.deepEqual(s.store.list('syllabi').map((v) => v.lineId !== ''), s.store.list('syllabi').map(() => true));
  assert.equal(s.store.list('syllabusLines').length, s.store.list('syllabi').length);
  assert.deepEqual(s.oneJoined(), []);
});

test('dir.remove: a person who stands only in a line or a member row, and a discipline with only a line, stay (in_use)', () => {
  const s = setup();
  s.call('syllabus.startDraft', { subjectId: s.sb4, semester: 1 }, s.t.dean);
  const [line] = s.store.list('syllabusLines');
  const [member] = s.store.list('syllabusMembers');
  const free = s.store.insert('staff', { fullName: 'Свободный', login: 'free', passwordHash: 'x', roles: 'teacher', lang: 'ky', mustChangePassword: false, active: true }).id;
  const remove = (table, id) => s.call('dir.remove', { table, id }, s.t.admin);
  assert.deepEqual([remove('staff', free).ok, s.store.list('staff').some((x) => x.id === free)], [true, false]);
  for (const [table, row, field] of [['syllabusLines', line, 'authorId'], ['syllabusLines', line, 'createdBy'], ['syllabusMembers', member, 'teacherId'],
    ['syllabusMembers', member, 'byId'], ['syllabusMembers', member, 'endedBy']]) {
    const other = s.store.insert('staff', { fullName: 'Другой ' + field, login: 'o' + field + table, passwordHash: 'x', roles: 'teacher', lang: 'ky', mustChangePassword: false, active: true }).id;
    const was = row[field];
    s.store.update(table, row.id, { [field]: other });
    const before = s.snapshot();
    assert.equal(code(remove('staff', other)), 'in_use', table + '.' + field);
    assert.deepEqual(s.snapshot(), before);
    s.store.update(table, row.id, { [field]: was });
    assert.equal(remove('staff', other).ok, true, table + '.' + field);
  }
  const ds3 = s.store.insert('disciplines', { name: 'Латынь' }).id;
  const ghost = s.store.insert('syllabusLines', { disciplineId: ds3, semester: 1, authorId: '', createdBy: '', createdAt: '2026-09-01 09:00:00' });
  assert.equal(code(remove('disciplines', ds3)), 'in_use');
  s.store.remove('syllabusLines', ghost.id);
  assert.equal(remove('disciplines', ds3).ok, true);
});
