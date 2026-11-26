// The choice of the deanery between several syllabi of one discipline in one half of the year ('syllabus.choose'): the chosen one becomes the syllabus
// of the group of everybody, the others go to the history, the future pairs are laid again. Every sheet is read at most once, the writes go in batches.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDateTime } from '../core/dates.js';
import { OPEN_STATUSES } from '../core/schema.js';
import { plainId } from '../core/syllabusSections.js';
import { inSemester } from '../core/topics.js';
import { lineFor, mainLine, ownLines, responsibleOf, switchLock, versionsOfLine } from '../core/disciplineSyllabus.js';
import { closedOfSubject } from './journalData.js';
import { loadSettings, relayout } from './scheduleData.js';

export const CHOICE_TABLES = ['syllabusLines', 'syllabi', 'subjects', 'staff', 'groups', 'topics', 'pairs', 'settings', 'closures', 'subjectExams', 'examAttempts'];

const HALVES = [1, 2];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const planOf = (version) => (version && Number.isInteger(version.planSemester) ? version.planSemester : null);
const isManagerRoles = (user) => Array.isArray(user.roles) && (user.roles.includes('admin') || user.roles.includes('dean'));

// The versions of the chosen line in its half. A repeat of a choice that broke after «Силлабусы» were written has them already on the main line of the
// discipline: when the own line has no version of the half and the main line exists, those of the main line stand for it.
export function chosenVersions(syllabi, lines, chosen) {
  const has = (syllabi || []).some((s) => s.lineId === chosen.id && s.semester === chosen.semester);
  const main = mainLine(lines, chosen.disciplineId);
  return versionsOfLine(syllabi, !has && main ? main.id : chosen.id, chosen.semester);
}

// The groups that the choice shuts out: [] (it may be made) or [{ field: 'group', code, name }] for 'line_locked'. Only the current half of the year counts:
// a closed unit or an exam of the plan halves of a group that changes its syllabus (the one it follows now, the chosen one and the one of its held pairs).
// rows: { subjects, syllabi, syllabusLines, topics, pairs, closures, subjectExams, examAttempts, groups }; chosen: the row of the chosen 'own' line.
export function choiceLocks(rows, settings, chosen) {
  if (!chosen || chosen.semester !== settings.semester) return [];
  const half = chosen.semester;
  const target = planOf(chosenVersions(rows.syllabi, rows.syllabusLines, chosen).approved);
  const names = new Map((rows.groups || []).map((g) => [g.id, g.name]));
  const fields = [];
  for (const subject of rows.subjects.filter((s) => s.disciplineId === chosen.disciplineId)) {
    const current = lineFor(rows.syllabusLines, { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: half });
    if (current === chosen.id) continue;
    const pairs = rows.pairs.filter((p) => p.subjectId === subject.id && inSemester(p.date, settings));
    const planSemesters = new Set([
      planOf(current ? versionsOfLine(rows.syllabi, current, half).approved : null), target, closedOfSubject(rows, subject, settings, pairs).planSemester,
    ]);
    const code = switchLock(subject.id, planSemesters, rows);
    if (code !== null) fields.push({ field: 'group', code, name: names.get(subject.groupId) ?? '' });
  }
  return fields.sort((a, b) => cmp(a.name, b.name) || cmp(a.code, b.code));
}

// 'syllabus.choose' { disciplineId, semester, lineId, confirm? } -> { chosen: true, resolved, changedPairs }
// resolved: no half of the discipline waits for a choice any more, so the 'own' lines left are merged into the one 'main' line of the discipline.
export function chooseSyllabus(store, platform, data, user) {
  const disciplineId = plainId(data.disciplineId);
  const lineId = plainId(data.lineId);
  const half = data.semester;
  if (disciplineId === null || lineId === null || !HALVES.includes(half) || (data.confirm !== undefined && typeof data.confirm !== 'boolean')) throw new AppError('bad_request');
  if (!isManagerRoles(user)) throw new AppError('forbidden');

  const disciplines = store.list('disciplines');
  const lines = store.list('syllabusLines');
  const syllabi = store.list('syllabi');
  const subjects = store.list('subjects');
  const groups = store.list('groups');
  const topics = store.list('topics');
  const pairs = store.list('pairs');
  const closures = store.list('closures');
  const subjectExams = store.list('subjectExams');
  const examAttempts = store.list('examAttempts');
  const settings = loadSettings(store);

  if (!disciplines.some((d) => d.id === disciplineId)) throw new AppError('not_found');
  const chosen = lines.find((l) => l.id === lineId && l.kind === 'own' && l.disciplineId === disciplineId && l.semester === half);
  if (!chosen) throw new AppError('not_found');

  const fields = choiceLocks({ subjects, syllabi, syllabusLines: lines, topics, pairs, closures, subjectExams, examAttempts, groups }, settings, chosen);
  if (fields.length > 0) throw new AppError('line_locked', { fields });

  const lost = ownLines(lines, disciplineId, half).filter((l) => l.id !== chosen.id);
  const lostIds = new Set(lost.map((l) => l.id));
  if (data.confirm !== true && !chosenVersions(syllabi, lines, chosen).approved
    && lost.some((l) => versionsOfLine(syllabi, l.id, half).approved)) throw new AppError('needs_confirm');

  const otherOwn = ownLines(lines, disciplineId, HALVES.find((h) => h !== half));
  const resolved = otherOwn.length <= 1;
  const merged = resolved ? [chosen, ...otherOwn] : [];
  const mergedIds = new Set(merged.map((l) => l.id));
  const ofDiscipline = subjects.filter((s) => s.disciplineId === disciplineId);

  // 1. what nobody refers to yet: the main line of the discipline (an earlier pass of this request may have made it)
  let main = resolved ? mainLine(lines, disciplineId) : null;
  let madeLines = [];
  if (resolved && !main) {
    const winners = {};
    for (const l of merged) winners[l.semester] = l.teacherId;
    [main] = store.insertMany('syllabusLines', [{
      disciplineId, kind: 'main', semester: null, teacherId: '', responsibleId: responsibleOf(winners, ofDiscipline, pairs), dueDate: '', reviewDue: '',
      createdBy: user.id, createdAt: localDateTime(platform.now()),
    }]);
    madeLines = [main];
  }

  // the rows as they will be
  const afterLines = [...lines.map((l) => (lostIds.has(l.id) || mergedIds.has(l.id) ? { ...l, kind: 'archived' } : l)), ...madeLines];
  const patches = [];
  const afterSyllabi = syllabi.map((s) => {
    if (lostIds.has(s.lineId) && OPEN_STATUSES.includes(s.status)) {
      patches.push({ id: s.id, patch: { status: 'archived' } });
      return { ...s, status: 'archived' };
    }
    if (mergedIds.has(s.lineId)) {
      patches.push({ id: s.id, patch: { lineId: main.id } });
      return { ...s, lineId: main.id };
    }
    return s;
  });

  // 2. «Пары»: the groups of the discipline follow the pick (held pairs with a topic keep it; the future ones go on from the next topic)
  const laid = relayout(store, ofDiscipline.map((s) => s.id), { subjects, syllabi: afterSyllabi, syllabusLines: afterLines, topics, pairs, settings }, []);
  // 3. «Силлабусы», 4. «Силлабусы дисциплин»
  if (patches.length > 0) store.updateMany('syllabi', patches);
  const retired = [...lost, ...merged].map((l) => ({ id: l.id, patch: { kind: 'archived' } }));
  if (retired.length > 0) store.updateMany('syllabusLines', retired);
  return { chosen: true, resolved, changedPairs: laid.changed };
}
