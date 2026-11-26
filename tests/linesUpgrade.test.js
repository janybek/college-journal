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

// What the earlier code left laid on the pairs of a subject: the lessons of an old version, in order (no line existed then).
function lay(s, subjectId, versionId) {
  const rows = s.store.list('topics').filter((x) => x.syllabusId === versionId && x.lessonKind !== 'control').sort((a, b) => a.order - b.order);
  const pairs = s.store.list('pairs').filter((p) => p.subjectId === subjectId).sort((a, b) => a.date.localeCompare(b.date));
  rows.forEach((row, i) => { if (pairs[i]) s.store.update('pairs', pairs[i].id, { topicId: row.id, lessonType: 'lecture', part: 1 }); });
}

// A base without names of rows: ids are random, so people, lines and versions are written by what they are.
function shape(s) {
  const who = new Map(Object.entries(s.ids).map(([key, id]) => [id, key]));
  const w = (id) => who.get(id) ?? id;
  const lineKey = new Map(s.store.list('syllabusLines').map((l) => [l.id, `${l.kind}|${l.disciplineId === s.ds1 ? 'ds1' : 'ds2'}|${l.semester}|${w(l.teacherId)}|${w(l.responsibleId)}`]));
  const subjectKey = new Map(['sb1', 'sb2', 'sb3', 'sb4'].map((k) => [s[k], k]));
  const topicName = new Map(s.store.list('topics').map((x) => [x.id, x.name]));
  return {
    lines: [...lineKey.values()].sort(),
    versions: s.store.list('syllabi').map((v) => `${w(v.teacherId)}|${v.semester}|${v.version}|${v.status}|${lineKey.get(v.lineId) ?? 'none'}`).sort(),
    pairs: s.store.list('pairs').map((p) => `${subjectKey.get(p.subjectId)}|${p.date}|${p.status}|${topicName.get(p.topicId) ?? ''}|${p.lessonType}|${p.part}`).sort(),
  };
}

// Anatomy: t1 (sb1) - autumn version 1 approved («А»), t2 (sb2) - nothing, t3 (sb3) - only a draft of the autumn; the pair of sb1 of 1 September is held.
function anatomy() {
  const s = setup();
  const v1 = s.old(s.sb1, s.FILE_A);
  s.old(s.sb3, s.FILE_B, { status: 'draft' });
  lay(s, s.sb1, v1);
  s.hold(s.sb1, '2026-09-01');
  return s;
}

test('applyLinesUpgrade: the syllabus of the discipline, a line of the history, the groups without topics get them, a second run writes nothing', () => {
  const s = anatomy();
  const topicsBefore = s.topicsOf(s.sb1);
  assert.deepEqual(topicsBefore.slice(0, 3), ['А1', 'А2', 'А3']);
  const before = s.snapshot();
  const up = s.upgrade();
  assert.deepEqual([up.lines, up.skipped, up.waiting, up.relaid > 0], [2, 0, 0, true]);
  const main = s.main(s.ds1);
  assert.deepEqual([main.kind, main.responsibleId, main.semester, main.createdBy, main.createdAt !== '', main.dueDate, main.reviewDue], ['main', s.ids.t1, null, '', true, '', '']);
  assert.deepEqual(s.lines(s.ds1).map((l) => [l.kind, l.teacherId]), [['main', ''], ['archived', s.ids.t3]]);
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  assert.equal(s.topicsOf(s.sb3)[0], 'А1');
  assert.deepEqual(s.topicsOf(s.sb1), topicsBefore);
  const strip = (rows) => rows.map(({ lineId, status, ...rest }) => rest);
  assert.deepEqual(strip(s.store.list('syllabi')), strip(before.syllabi));
  assert.deepEqual(s.store.list('syllabi').map((v) => v.status).sort(), ['approved', 'archived']);
  assert.deepEqual(s.oneMain(), []);
  const held = s.store.list('pairs').find((p) => p.subjectId === s.sb1 && p.date === '2026-09-01');
  assert.deepEqual([held.status, held.lessonType, held.part], ['closed', 'lecture', 1]);
  s.spy.reset();
  assert.deepEqual([applyLinesUpgrade(s.spied, s.platform), s.spy.writes], [{ lines: 0, skipped: 0, waiting: 0, relaid: 0 }, {}]);
  assert.deepEqual(s.spy.lists, { syllabi: 1, syllabusLines: 1 });
});

test('two approved syllabi of one half wait for the choice: no main, nobody changes topics', () => {
  const s = setup();
  const a = s.old(s.sb1, s.FILE_A);
  const b = s.old(s.sb2, s.FILE_B);
  lay(s, s.sb1, a);
  lay(s, s.sb2, b);
  const before = [s.sb1, s.sb2, s.sb3].map((id) => s.topicsOf(id));
  const up = s.upgrade();
  assert.deepEqual([up.lines, up.waiting, up.relaid], [2, 1, 0]);
  assert.equal(s.main(s.ds1), undefined);
  assert.deepEqual(s.lines(s.ds1).map((l) => [l.kind, l.semester, l.teacherId, l.responsibleId]).sort(), [['own', 1, s.ids.t1, ''], ['own', 1, s.ids.t2, '']].sort());
  assert.deepEqual([s.sb1, s.sb2, s.sb3].map((id) => s.topicsOf(id)), before);
  assert.equal(s.topicsOf(s.sb3).filter(Boolean).length, 0);
  assert.deepEqual(s.store.list('syllabi').map((v) => v.status), ['approved', 'approved']);
  assert.deepEqual(s.oneMain(), []);
});

test('a held pair with a topic keeps its topic, kind and part after any move', () => {
  const s = setup();
  const a = s.old(s.sb1, s.FILE_A);
  const draft = s.old(s.sb2, s.FILE_B, { status: 'draft' });
  lay(s, s.sb1, a);
  lay(s, s.sb2, draft);
  s.hold(s.sb2, '2026-09-02');
  s.hold(s.sb2, '2026-09-09');
  const before = s.store.list('pairs').filter((p) => p.status === 'closed').map(({ id, topicId, lessonType, part }) => [id, topicId, lessonType, part]);
  const up = s.upgrade();
  assert.equal(up.lines, 2);
  const after = s.store.list('pairs').filter((p) => p.status === 'closed').map(({ id, topicId, lessonType, part }) => [id, topicId, lessonType, part]);
  assert.deepEqual(after, before);
  assert.deepEqual(s.store.list('syllabi').map((v) => v.status).sort(), ['approved', 'archived']);
});

test('a line without a kind (the shared lines of the earlier build) is wiped; its versions are moved again', () => {
  const s = setup();
  const a = s.old(s.sb1, s.FILE_A);
  const ghost = s.store.insert('syllabusLines', { disciplineId: s.ds1, semester: 1, teacherId: s.ids.t1, createdBy: '', createdAt: '2026-09-01 09:00:00' });
  s.store.update('syllabi', a, { lineId: ghost.id });
  const up = s.upgrade();
  assert.equal(up.lines, 1);
  assert.deepEqual(s.lines(s.ds1).map((l) => l.kind), ['main']);
  assert.equal(s.store.list('syllabi').find((v) => v.id === a).lineId, s.main(s.ds1).id);
  assert.equal(s.lines(s.ds1).some((l) => l.id === ghost.id), false);
  assert.deepEqual(s.oneMain(), []);
});

test('versions that the earlier code wrote after a rollback: the key of the responsible - on main, the key of another - on a line of the history', () => {
  const s = setup();
  s.old(s.sb1, s.FILE_A);
  s.upgrade();
  const main = s.main(s.ds1);
  const mine = s.old(s.sb1, s.FILE_B, { status: 'draft', version: 2 });
  const other = s.old(s.sb2, s.FILE_B, { status: 'approved', version: 1 });
  const up = s.upgrade();
  assert.equal(up.lines, 1);
  const rows = s.store.list('syllabi');
  assert.equal(rows.find((v) => v.id === mine).lineId, main.id);
  const home = s.store.list('syllabusLines').find((l) => l.id === rows.find((v) => v.id === other).lineId);
  assert.deepEqual([home.kind, home.teacherId, home.semester], ['archived', s.ids.t2, 1]);
  assert.equal(rows.filter((v) => v.lineId === main.id && v.status === 'approved').length, 1);
  assert.deepEqual(s.oneMain(), []);
});

test('mending: two approved versions of one half of main - the earlier goes to the archive, the pairs stay, a second run writes nothing', () => {
  const s = setup();
  const a = s.old(s.sb1, s.FILE_A);
  lay(s, s.sb1, a);
  s.upgrade();
  const main = s.main(s.ds1);
  const stray = s.old(s.sb1, s.FILE_A, { status: 'approved', version: 2 });
  s.store.update('syllabi', stray, { lineId: main.id });
  const topics = [s.sb1, s.sb2, s.sb3].map((id) => s.topicsOf(id));
  const up = s.upgrade();
  assert.equal(up.lines, 0);
  assert.deepEqual(s.store.list('syllabi').map((v) => [v.version, v.status]).sort(), [[1, 'archived'], [2, 'approved']]);
  assert.deepEqual([s.sb1, s.sb2, s.sb3].map((id) => s.topicsOf(id)), topics);
  s.spy.reset();
  assert.deepEqual([applyLinesUpgrade(s.spied, s.platform), s.spy.writes], [{ lines: 0, skipped: 0, waiting: 0, relaid: 0 }, {}]);
});

// three bases where a break between two writes must not change the result
const BASES = {
  'the winner of the spring is not the responsible': (s) => {
    s.old(s.sb1, s.FILE_A);
    s.old(s.sb2, s.FILE_B, { semester: 2 });
    s.store.update('pairs', s.store.list('pairs').find((p) => p.subjectId === s.sb2).id, { status: 'closed' });
  },
  'the only syllabus belongs to a teacher who does not lead the discipline': (s) => {
    s.store.insert('syllabi', { disciplineId: s.ds1, teacherId: s.ids.t5, semester: 1, planSemester: 1, status: 'approved', version: 1 });
  },
  'the discipline waits for the choice': (s) => {
    const a = s.old(s.sb1, s.FILE_A);
    s.old(s.sb2, s.FILE_B);
    s.old(s.sb3, s.FILE_B, { status: 'draft' });
    lay(s, s.sb1, a);
  },
};
for (const [name, make] of Object.entries(BASES)) {
  test(`a break in the move is mended by the next start (${name})`, () => {
    const clean = setup();
    make(clean);
    clean.upgrade();
    for (const [method, table] of [['updateMany', 'syllabi'], ['insertMany', 'syllabusLines'], ['updateMany', 'pairs']]) {
      const s = setup();
      make(s);
      try { applyLinesUpgrade(s.failingOn(method, table), s.platform); } catch (error) { assert.match(error.message, /boom/); }
      s.upgrade();
      assert.deepEqual(shape(s), shape(clean), `${method} ${table}`);
      assert.deepEqual(s.oneMain(), []);
      s.spy.reset();
      assert.deepEqual([applyLinesUpgrade(s.spied, s.platform), s.spy.writes], [{ lines: 0, skipped: 0, waiting: 0, relaid: 0 }, {}]);
    }
  });
}

test('the order of the writes: lines are wiped and made first, then the pairs, then the versions', () => {
  const s = anatomy();
  const order = [];
  const wrapped = { ...s.store };
  for (const m of ['insertMany', 'updateMany', 'removeMany']) wrapped[m] = (table, rows) => { order.push(`${m}:${table}`); return s.store[m](table, rows); };
  applyLinesUpgrade(wrapped, s.platform);
  assert.deepEqual(order, ['insertMany:syllabusLines', 'updateMany:pairs', 'updateMany:syllabi']);
});

test('applyLinesUpgrade on SQLite is one transaction: a failed write leaves no lines and the pairs as they were', (t) => {
  const dir = tempDir(t);
  const db = openDatabase(path.join(dir, 'lines.sqlite'));
  keep(t, { close: () => db.close() });
  ensureTables(SCHEMA, db);
  const platform = createNodePlatform({ now: () => Date.UTC(2026, 9, 1, 6), secret: 'test-secret' });
  const store = createSqliteStore(SCHEMA, platform, db);
  store.insert('syllabi', { disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, status: 'approved', version: 1 });
  const pairsBefore = store.list('pairs');
  assert.throws(() => applyLinesUpgrade(failingOn(store, 'updateMany', 'syllabi'), platform), /boom/);
  assert.deepEqual([store.list('syllabusLines').length, store.list('syllabi')[0].lineId, store.list('pairs')], [0, '', pairsBefore]);
  assert.deepEqual(applyLinesUpgrade(store, platform), { lines: 1, skipped: 0, waiting: 0, relaid: 0 });
  assert.equal(store.list('syllabi')[0].lineId, store.list('syllabusLines')[0].id);
});

test('the start of the server makes the syllabi once and says so; the second start says nothing', async (t) => {
  const { config } = tempBase(t);
  const base = keep(t, openBase(config));
  base.store.insert('syllabi', { disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, status: 'approved', version: 1 });
  base.store.insert('syllabi', { disciplineId: 'ds_1', teacherId: '', semester: 1, status: 'draft', version: 2 });
  base.db.exec('DROP TABLE "syllabusLines"');
  for (const column of ['lineId', 'sourceId']) base.db.exec(`ALTER TABLE "syllabi" DROP COLUMN "${column}"`);
  base.close();
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {} }));
  const log = () => fs.readFileSync(config.logFile, 'utf8');
  assert.match(log(), /base upgraded: 1 tables made, 2 columns added/);
  assert.match(log(), /discipline syllabi made: 1, waiting for a choice: 0, pairs laid: 0, rows without a syllabus: 1/);
  assert.equal(run.base.store.list('syllabusLines').length, 1);
  await run.stop();
  const size = log().length;
  const second = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {} }));
  assert.equal(second.code, 0);
  assert.doesNotMatch(log().slice(size), /base upgraded|discipline syllabi made/);
});

test('the stand: an old file gets its syllabi and a copy beside it; a fresh stand gets no copy', async (t) => {
  const dir = tempDir(t);
  const siteDir = path.join(dir, 'site');
  fs.mkdirSync(siteDir);
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<title>x</title>');
  const dataFile = path.join(dir, 'db.json');
  const copy = dataFile + '.before-discipline-syllabus.bak';
  const said = [];
  const log = console.log;
  console.log = (line) => said.push(String(line));
  try {
    await (await startDevServer({ port: 0, dataFile, siteDir })).close();
    const fresh = fs.readFileSync(dataFile, 'utf8');
    assert.equal(fs.existsSync(copy), false);
    // the same file as the earlier code left it: no line anywhere
    const data = JSON.parse(fresh);
    const text = JSON.stringify({ ...data, syllabi: data.syllabi.map((v) => ({ ...v, lineId: '', sourceId: '' })), syllabusLines: [] });
    fs.writeFileSync(dataFile, text);
    said.length = 0;
    await (await startDevServer({ port: 0, dataFile, siteDir })).close();
    assert.equal(fs.readFileSync(copy, 'utf8'), text);
    const after = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.deepEqual([after.syllabi.every((v) => v.lineId !== ''), after.syllabusLines.length > 0, said.some((l) => /^discipline syllabi made: \d+/.test(l))], [true, true, true]);
    // the copy is kept as it is on the next start
    await (await startDevServer({ port: 0, dataFile, siteDir })).close();
    assert.equal(fs.readFileSync(copy, 'utf8'), text);
  } finally {
    console.log = log;
  }
  // a file with the lines of the shared build (no kind) is copied too
  const shared = path.join(dir, 'shared.json');
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  fs.writeFileSync(shared, JSON.stringify({ ...data, syllabusLines: data.syllabusLines.map(({ kind, ...line }) => line) }));
  console.log = () => {};
  try {
    await (await startDevServer({ port: 0, dataFile: shared, siteDir })).close();
  } finally {
    console.log = log;
  }
  assert.equal(fs.existsSync(shared + '.before-discipline-syllabus.bak'), true);
});
