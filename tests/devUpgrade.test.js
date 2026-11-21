import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upgradeData, upgradeFile } from '../dev/upgrade.js';
import { startDevServer } from '../dev/server.js';
import { seedAdmin, DEV_PASSWORD } from '../dev/seed.js';
import { SCHEMA } from '../core/schema.js';
import { lessonsOf, lessonKey } from '../core/topics.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';

// Fictional data of the old shape: syllabus sy_1 and rows t1 lecture 2 + practice 2; t2 lecture 4; t3 practice 4 (seminar);
// c1 module 0 h; t4 lecture 2 + practice 4 (lab); c2 module 2 h «Экзамен»; pairs p1-p5.
const oldRow = (id, order, unit, kind, name, lectureHours, practiceHours, practiceKind = '', unitTitle = '') =>
  ({ id, syllabusId: 'sy_1', order, unit, label: '', name, lectureHours, practiceHours, practiceKind, selfHours: null, description: '', kind, unitTitle });
const pair = (id, status, topicId, lessonType, part) => ({ id, date: '2026-09-0' + id.slice(1), slot: 1, groupId: 'g_1', subjectId: 'sb_1', teacherId: 'sf_1',
  roomId: 'r_1', topicId, lessonType, part, status, planDate: '', planSlot: null, changed: false, note: '' });
const oldData = () => ({
  syllabi: [{ id: 'sy_1', disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, planSemester: 1, audience: '', credits: null, totalHours: null,
    classHours: null, selfHours: null, updated: '2026-08-31' }],
  topics: [oldRow('t1', 1, 1, 'topic', 'Тема 1', 2, 2, '', 'Основы'), oldRow('t2', 2, 1, 'topic', 'Тема 2', 4, 0, '', 'Основы'),
    oldRow('t3', 3, 1, 'topic', 'Тема 3', 0, 4, 'seminar', 'Основы'), oldRow('c1', 4, 1, 'control', '', 0, 0, '', 'Основы'),
    oldRow('t4', 5, 2, 'topic', 'Тема 4', 2, 4, 'lab'), oldRow('c2', 6, 2, 'control', 'Экзамен', 0, 2)],
  pairs: [pair('p1', 'closed', 't1', 'lecture', 1), pair('p2', 'closed', 't1', 'practice', 1), pair('p3', 'planned', 't2', 'lecture', 1),
    pair('p4', 'planned', 't4', 'practice', 2), pair('p5', 'planned', '', '', null)],
});
let next = 0;
const newId = (prefix, taken) => { let id; do id = `${prefix}_new${++next}`; while (taken.has(id)); return id; };

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-upgrade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('upgradeData: a file of the old shape becomes one lesson per row, pairs keep their lessons, a second call changes nothing', () => {
  const data = oldData();
  const nameOf = (id) => (data.topics.find((t) => t.id === id) || { name: '' }).name;
  const before = data.pairs.map((p) => [p.id, nameOf(p.topicId), p.lessonType, p.part]);
  const report = upgradeData(data, newId);
  assert.deepEqual(report, { changed: true, versions: 1, split: 2, units: 2, skipped: [], zeroHours: [] });
  assert.deepEqual(data.topics.map((t) => [t.order, t.lessonKind, t.name, t.hours]), [[1, 'lecture', 'Тема 1', 2], [2, 'practice', 'Тема 1', 2], [3, 'lecture', 'Тема 2', 4],
    [4, 'seminar', 'Тема 3', 4], [5, 'control', '', 0], [6, 'lecture', 'Тема 4', 2], [7, 'lab', 'Тема 4', 4], [8, 'control', 'Экзамен', 2]]);
  assert.equal(data.topics.some((t) => 'lectureHours' in t || 'kind' in t || 'label' in t || 'practiceHours' in t || 'practiceKind' in t), false);
  assert.deepEqual(data.pairs.map((p) => [p.id, nameOf(p.topicId), p.lessonType, p.part]), before);
  const keys = new Set(lessonsOf(data.topics).map(lessonKey));
  assert.equal(data.pairs.filter((p) => p.topicId).every((p) => keys.has(lessonKey(p))), true);
  assert.deepEqual([data.syllabi[0].status, data.syllabi[0].version, data.syllabi[0].manualOrder, data.units.map((u) => [u.syllabusId, u.unit, u.title])],
    ['approved', 1, true, [['sy_1', 1, 'Основы'], ['sy_1', 2, '']]]);
  const text = JSON.stringify(data);
  assert.deepEqual([upgradeData(data, newId), JSON.stringify(data)], [{ changed: false, versions: 0, split: 0, units: 0, skipped: [], zeroHours: [] }, text]);
});

test('upgradeData: status "" is the old shape too; a row with neither lessonKind nor old keys is left alone and named', () => {
  const mixed = oldData();
  mixed.syllabi[0].status = '';
  mixed.topics.push({ id: 't9', syllabusId: 'sy_1', order: 7, unit: 2, name: 'Странная', unitTitle: '' });
  assert.deepEqual(upgradeData(mixed, newId), { changed: true, versions: 1, split: 2, units: 2, skipped: ['t9'], zeroHours: [] });
  assert.deepEqual(mixed.topics.find((t) => t.id === 't9'), { id: 't9', syllabusId: 'sy_1', order: 9, unit: 2, name: 'Странная', unitTitle: '' });
});

test('upgradeData: a version of the new shape is not touched', () => {
  const data = {
    syllabi: [{ id: 'sy_2', disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, status: 'draft', version: 2 }],
    topics: [{ id: 't1', syllabusId: 'sy_2', order: 1, unit: 1, lessonKind: 'lecture', name: 'A', hours: 2 }],
    pairs: [],
  };
  const text = JSON.stringify(data);
  assert.deepEqual(upgradeData(data, newId), { changed: false, versions: 0, split: 0, units: 0, skipped: [], zeroHours: [] });
  assert.equal(JSON.stringify(data), text);
});

test('upgradeFile: the copy is written once and keeps the old shape; a file of the new shape is not touched', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'real.json');
  const bak = file + '.before-addendum-3.bak';
  const oldText = JSON.stringify(oldData());
  fs.writeFileSync(file, oldText);
  assert.equal(upgradeFile(file).changed, true);
  assert.deepEqual([fs.readFileSync(bak, 'utf8'), JSON.parse(fs.readFileSync(file, 'utf8')).topics.length], [oldText, 8]);
  const newText = fs.readFileSync(file, 'utf8');
  assert.equal(upgradeFile(file).changed, false);
  assert.deepEqual([fs.readFileSync(file, 'utf8'), fs.readFileSync(bak, 'utf8')], [newText, oldText]);
  fs.writeFileSync(file, JSON.stringify({ ...oldData(), syllabi: [{ ...oldData().syllabi[0], audience: 'другое' }] }));
  upgradeFile(file);
  assert.equal(fs.readFileSync(bak, 'utf8'), oldText);
  const fresh = path.join(dir, 'new.json');
  fs.writeFileSync(fresh, newText);
  assert.deepEqual([upgradeFile(fresh).changed, fs.readFileSync(fresh, 'utf8'), fs.existsSync(fresh + '.before-addendum-3.bak')], [false, newText, false]);
  assert.deepEqual([upgradeFile(path.join(dir, 'missing.json')).changed, fs.existsSync(path.join(dir, 'missing.json'))], [false, false]);
});

test('upgradeData: a row that is not a module and has no hours is named in zeroHours; a module without hours gets 0', () => {
  const data = oldData();
  data.topics.push(oldRow('z1', 7, 2, 'topic', 'Пустая', 0, 0), oldRow('z2', 8, 2, 'topic', 'Без часов', null, null), oldRow('z3', 9, 2, 'topic', 'Строка', '', ''));
  data.topics.push({ ...oldRow('m1', 10, 2, 'control', '', 0, null) });
  const report = upgradeData(data, newId);
  assert.deepEqual(report.zeroHours, ['z1', 'z2', 'z3']);
  const rowOf = (id) => data.topics.find((t) => t.id === id);
  assert.deepEqual(['z1', 'z2', 'z3'].map((id) => [rowOf(id).lessonKind, rowOf(id).hours]), [['lecture', 0], ['lecture', 0], ['lecture', 0]]);
  assert.deepEqual([rowOf('m1').lessonKind, rowOf('m1').hours], ['control', 0]);
  assert.deepEqual(upgradeData(data, newId).zeroHours, []);
});

test('upgradeFile: an empty or broken file gives a clear error and stays byte for byte; no copy is made', (t) => {
  const dir = tempDir(t);
  for (const [name, text] of [['empty.json', ''], ['broken.json', '{"syllabi": [ {"id": '], ['array.json', '[]'], ['null.json', 'null']]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    assert.throws(() => upgradeFile(file), (error) => error.message === `файл ${file} повреждён, перенос не сделан, файл не тронут`, name);
    assert.deepEqual([fs.readFileSync(file, 'utf8'), fs.existsSync(file + '.before-addendum-3.bak')], [text, false], name);
  }
});

// A fictional stand of the old shape: one admin, one teacher, one group, one discipline, one subject, no students.
function oldStand() {
  const platform = createNodePlatform();
  const data = {};
  const store = createMemoryStore(SCHEMA, platform, data);
  seedAdmin(store, platform);
  return {
    ...data,
    staff: [...data.staff, { id: 'sf_1', fullName: 'Вымышленный Преподаватель', login: 'teacher_x', passwordHash: '', roles: 'teacher', lang: 'ru', mustChangePassword: false, active: true }],
    groups: [{ id: 'g_1', name: 'ТЕСТ-1', course: 1 }],
    disciplines: [{ id: 'ds_1', name: 'Информатика' }],
    subjects: [{ id: 'sb_1', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A', disciplineId: 'ds_1' }],
    settings: [{ id: 'cfg_1', key: 'semester', value: '1' }],
    ...oldData(),
  };
}

const post = (srv, body) => fetch(srv.url + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then((r) => r.json());
const login = async (srv, name) => (await post(srv, { action: 'auth.login', data: { login: name, password: DEV_PASSWORD } })).data.token;
const api = (srv, action, data, token) => post(srv, { action, token, data });

test('stand of real data on a file of the old shape: same dates on the same lessons, no fictional people, the second start changes nothing', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'real.json');
  fs.writeFileSync(file, JSON.stringify(oldStand()));
  const datesBefore = oldStand().pairs.filter((p) => p.topicId).map((p) => [p.date, oldStand().topics.find((x) => x.id === p.topicId).name, p.lessonType, p.part]);
  const first = await startDevServer({ port: 0, dataFile: file, siteDir: dir, mode: 'real' });
  const token = await login(first, 'admin');
  const page = await api(first, 'syllabus.get', { subjectId: 'sb_1' }, token);
  await first.close();
  assert.equal(page.ok, true, JSON.stringify(page));
  const datesAfter = page.data.syllabus.rows.filter((r) => r.lessonKind !== 'control').flatMap((r) => r.pairs.map((p) => [p.date, r.name, p.lessonType, p.part]));
  assert.deepEqual(datesAfter.sort(), datesBefore.sort());
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([saved.staff.map((s) => s.login), (saved.students || []).length, saved.groups.map((g) => g.id)], [['admin', 'teacher_x'], 0, ['g_1']]);
  assert.equal(fs.existsSync(file + '.before-addendum-3.bak'), true);
  const text = fs.readFileSync(file, 'utf8');
  const second = await startDevServer({ port: 0, dataFile: file, siteDir: dir, mode: 'real' });
  await second.close();
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});
