// One syllabus per discipline: its row («line»), the halves of the year, who is responsible, which line a subject follows,
// where a new draft goes and how the old syllabi move onto lines. Pure functions over rows; no storage, no network.
import { versionsIn, versionsOf } from './syllabusFlow.js';
import { LINE_KINDS, OPEN_STATUSES } from './schema.js';

const HALVES = [1, 2];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const arr = (rows) => (Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : []);
const byCreated = (a, b) => cmp(a.createdAt || '', b.createdAt || '') || cmp(a.id, b.id);
const nonEmpty = (v) => typeof v === 'string' && v !== '';
const hasRole = (viewer, role) => Array.isArray(viewer?.roles) && viewer.roles.includes(role);

// The 'main' row of the discipline or null; of several, the earlier createdAt, then id.
export function mainLine(lines, disciplineId) {
  return arr(lines).filter((l) => l.kind === 'main' && l.disciplineId === disciplineId).sort(byCreated)[0] || null;
}

// The 'own' rows (an old syllabus of a teacher that waits for the choice) of the discipline and the half.
export function ownLines(lines, disciplineId, half) {
  return arr(lines).filter((l) => l.kind === 'own' && l.disciplineId === disciplineId && l.semester === half).sort(byCreated);
}

// The halves of the year where the discipline has more than one 'own' row: they wait for the choice of the deanery.
export function waitingHalves(lines, disciplineId) {
  return HALVES.filter((h) => ownLines(lines, disciplineId, h).length > 1);
}

// The id of the line a subject follows in this half: the only 'own' of the half (everybody follows it); of several, the one of the
// teacher of the subject (or null); none: the 'main' of the discipline or null. 'archived' rows never count.
export function lineFor(lines, { disciplineId, teacherId, semester }) {
  const own = ownLines(lines, disciplineId, semester);
  if (own.length > 1) return own.find((l) => nonEmpty(teacherId) && l.teacherId === teacherId)?.id ?? null;
  if (own.length === 1) return own[0].id;
  return mainLine(lines, disciplineId)?.id ?? null;
}

// { approved, open, last } of the rows of the line in one half of the year.
export function versionsOfLine(syllabi, lineId, half) {
  if (!lineId) return versionsIn([]);
  return versionsIn(arr(syllabi).filter((s) => s.lineId === lineId && s.semester === half));
}

const openOf = (syllabi, lineId) => {
  const halves = new Map();
  for (const s of arr(syllabi)) if (lineId && s.lineId === lineId) halves.set(s.semester, true);
  return [...halves.keys()].sort((a, b) => a - b).map((h) => versionsOfLine(syllabi, lineId, h).open).filter(Boolean);
};

// The open rows of the line, one per half (the later one), by half.
export const openRows = (syllabi, lineId) => openOf(syllabi, lineId);

// Of those, the rows on approval.
export const reviewRows = (syllabi, lineId) => openOf(syllabi, lineId).filter((s) => s.status === 'review');

// The number of a new version: 1 + the greatest of the numbers of the line (both halves) and of the old key «discipline + teacher + half».
export function nextVersion(syllabi, lineId, { disciplineId, teacherId }) {
  const onLine = arr(syllabi).filter((s) => lineId && s.lineId === lineId).map((s) => Number(s.version) || 0);
  const old = HALVES.map((semester) => versionsOf(syllabi, { disciplineId, teacherId, semester }).last);
  return 1 + Math.max(0, ...onLine, ...old);
}

export function teacherSubjects(subjects, disciplineId, teacherId) {
  return arr(subjects).filter((s) => s.disciplineId === disciplineId && s.teacherId === teacherId);
}

// The subjects of the line's discipline that follow this line in the half.
export function lineSubjects(subjects, line, lines, half) {
  return arr(subjects).filter((s) => s.disciplineId === line.disciplineId
    && lineFor(lines, { disciplineId: s.disciplineId, teacherId: s.teacherId, semester: half }) === line.id);
}

// 'responsible' | 'teaches' | null: the place of the person on the line.
export function partOf(line, userId, subjects, lines) {
  if (!line || line.kind === 'archived' || !nonEmpty(userId)) return null;
  const teaches = teacherSubjects(subjects, line.disciplineId, userId).length > 0;
  if (line.kind === 'main') {
    if (line.responsibleId === userId) return 'responsible';
    return teaches ? 'teaches' : null;
  }
  if (line.kind !== 'own' || !teaches) return null;
  if (line.teacherId === userId) return 'responsible';
  return lineFor(lines, { disciplineId: line.disciplineId, teacherId: userId, semester: line.semester }) === line.id ? 'teaches' : null;
}

// What stops the subject from switching: a closed unit (not reopened) or an exam row of one of the plan semesters.
// planSemesters: Set (null inside is allowed). -> 'unit_closed' | 'exam_exists' | null
export function switchLock(subjectId, planSemesters, { closures = [], subjectExams = [], examAttempts = [] } = {}) {
  if (!planSemesters || planSemesters.size === 0) return null;
  const inSet = (row) => planSemesters.has(row.planSemester ?? null);
  if (closures.some((c) => c.subjectId === subjectId && !c.reopenedAt && inSet(c))) return 'unit_closed';
  if (subjectExams.some((x) => x.subjectId === subjectId && inSet(x)) || examAttempts.some((x) => x.subjectId === subjectId && inSet(x))) return 'exam_exists';
  return null;
}

// Pairs of each teacher of the discipline: Map(teacherId -> number of pairs of his subjects).
function pairCounts(subjects, pairs, disciplineId) {
  const owner = new Map(arr(subjects).filter((s) => disciplineId === undefined || s.disciplineId === disciplineId).map((s) => [s.id, s.teacherId]));
  const count = new Map([...new Set(owner.values())].map((t) => [t, 0]));
  for (const p of arr(pairs)) if (owner.has(p.subjectId)) count.set(owner.get(p.subjectId), count.get(owner.get(p.subjectId)) + 1);
  return count;
}

// The id for the column «teacher» of a new version of the line: the responsible if he leads the discipline; else the leader with the most pairs
// (equal: the smaller id); nobody leads it: the responsible or fallbackId. subjects — the subjects of the discipline of the line.
export function versionTeacher(line, subjects, pairs, fallbackId = '') {
  if (!line) return fallbackId;
  if (line.kind !== 'main') return line.teacherId;
  const count = pairCounts(subjects, pairs, line.disciplineId);
  if (nonEmpty(line.responsibleId) && count.has(line.responsibleId)) return line.responsibleId;
  const leaders = [...count.keys()].filter(nonEmpty).sort((a, b) => count.get(b) - count.get(a) || cmp(a, b));
  return leaders.length ? leaders[0] : line.responsibleId || fallbackId;
}

// winners: { 1?: teacherId, 2?: teacherId } (the owners of the syllabus of each half) -> id of the responsible or ''.
// subjects — the subjects of this discipline; somebody who does not lead it is never responsible.
export function responsibleOf(winners, subjects, pairs) {
  const count = pairCounts(subjects, pairs);
  const leading = (id) => nonEmpty(id) && count.has(id);
  const autumn = winners?.[1];
  const spring = winners?.[2];
  if (autumn === spring || !nonEmpty(spring)) return leading(autumn) ? autumn : '';
  if (!nonEmpty(autumn)) return leading(spring) ? spring : '';
  if (!leading(autumn)) return leading(spring) ? spring : '';
  if (!leading(spring)) return autumn;
  return count.get(spring) > count.get(autumn) ? spring : autumn;
}

// [] or the ids of the disciplines that have more than one 'main' row (must be []).
export function oneMain(lines) {
  const seen = new Map();
  for (const l of arr(lines)) if (l.kind === 'main') seen.set(l.disciplineId, (seen.get(l.disciplineId) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id).sort();
}

// Where a new draft of the half `semester` goes. teacherId — the teacher of the subject ('' — a request by the discipline).
// viewer: { id, roles }. -> { code: 'ok' | 'forbidden' | 'choose_first', line: row | null, make: { responsibleId } | null, claim: boolean }
export function draftTarget(lines, syllabi, subjects, { disciplineId, teacherId = '', semester }, viewer) {
  const answer = (code, line = null, make = null, claim = false) => ({ code, line, make, claim });
  if (!viewer || typeof viewer !== 'object') return answer('forbidden');
  const manager = hasRole(viewer, 'admin') || hasRole(viewer, 'dean');
  const teacher = hasRole(viewer, 'teacher') && nonEmpty(viewer.id);
  const leads = teacher && teacherSubjects(subjects, disciplineId, viewer.id).length > 0;
  const own = ownLines(lines, disciplineId, semester);
  const forLine = (line) => (line && (manager || (leads && line.teacherId === viewer.id)) ? answer('ok', line) : answer('forbidden'));
  if (own.length > 1) {
    const theirs = nonEmpty(teacherId) ? own.find((l) => l.teacherId === teacherId) : null;
    return theirs ? forLine(theirs) : answer('choose_first');
  }
  if (own.length === 1) return forLine(own[0]);
  if (waitingHalves(lines, disciplineId).length) return answer('choose_first');
  const main = mainLine(lines, disciplineId);
  if (main) {
    if (manager || (teacher && main.responsibleId === viewer.id)) return answer('ok', main);
    const started = arr(syllabi).some((s) => s.lineId === main.id);
    if (teacher && main.responsibleId === '' && !started && leads) return answer('ok', main, null, true);
    return answer('forbidden');
  }
  if (manager) return answer('ok', null, { responsibleId: teacherId });
  if (leads) return answer('ok', null, { responsibleId: viewer.id });
  return answer('forbidden');
}

// ---- the move of the old syllabi onto lines ----

const laterFirst = (a, b) => (Number(b.version) || 0) - (Number(a.version) || 0) || cmp(b.id, a.id);

// Of the old syllabi of one half: the one that becomes the syllabus of the discipline. Candidates are the teachers who lead the discipline now
// (nobody: all). The winner has the only approved version, or is the only candidate when nothing is approved.
function winnerOf(groups, leaders) {
  let cands = groups.filter((g) => leaders.has(g.teacherId));
  if (!cands.length) cands = groups;
  const approved = cands.filter((g) => g.versions.some((v) => v.status === 'approved'));
  if (approved.length === 1) return { winner: approved[0], cands };
  if (!approved.length && cands.length === 1) return { winner: cands[0], cands };
  return { winner: null, cands };
}

// What to write so that every old version (without a line) lies on a line of the new kind. Safe to repeat: a second run on the result is empty.
// -> { wipe, lines: [{ ref, disciplineId, kind, semester, teacherId, responsibleId }], versions: [{ id, ref | lineId, status? }], retire, skipped, waiting, relay }
export function disciplineMigration(args) {
  const { syllabi, lines, subjects, pairs, half } = args || {};
  const allSyllabi = arr(syllabi);
  const allLines = arr(lines);
  const wipe = allLines.filter((l) => !LINE_KINDS.includes(l.kind)).map((l) => l.id);
  const live = allLines.filter((l) => LINE_KINDS.includes(l.kind));
  const liveIds = new Set(live.map((l) => l.id));

  const skipped = [];
  const byDiscipline = new Map();
  for (const s of allSyllabi) {
    if (s.lineId && liveIds.has(s.lineId)) continue;
    if (!s.disciplineId || !s.teacherId || !HALVES.includes(s.semester)) { skipped.push(s.id); continue; }
    if (!byDiscipline.has(s.disciplineId)) byDiscipline.set(s.disciplineId, new Map(HALVES.map((h) => [h, new Map()])));
    const teachers = byDiscipline.get(s.disciplineId).get(s.semester);
    if (!teachers.has(s.teacherId)) teachers.set(s.teacherId, { teacherId: s.teacherId, versions: [] });
    teachers.get(s.teacherId).versions.push(s);
  }

  const made = [];
  const placed = new Map();
  const addLine = (spec) => {
    const ref = `new:${made.length + 1}`;
    made.push({ ref, ...spec });
    return ref;
  };
  const place = (group, target, closeOpen = false) => {
    for (const v of group.versions) placed.set(v.id, { id: v.id, ...target, ...(closeOpen && OPEN_STATUSES.includes(v.status) ? { status: 'archived' } : {}) });
  };

  for (const disciplineId of [...byDiscipline.keys()].sort()) {
    const halves = HALVES.map((h) => ({ h, groups: [...byDiscipline.get(disciplineId).get(h).values()].sort((a, b) => cmp(a.teacherId, b.teacherId)) }));
    const mine = live.filter((l) => l.disciplineId === disciplineId);
    const ofDiscipline = arr(subjects).filter((s) => s.disciplineId === disciplineId);
    const leaders = new Set(ofDiscipline.map((s) => s.teacherId));
    const archive = (group, h, existing = null) => {
      if (existing) return place(group, { lineId: existing.id }, true);
      return place(group, { ref: addLine({ disciplineId, kind: 'archived', semester: h, teacherId: group.teacherId, responsibleId: '' }) }, true);
    };

    if (mine.length === 0) {
      const found = halves.map((x) => ({ ...x, ...winnerOf(x.groups, leaders) }));
      if (found.every((x) => x.groups.length === 0 || x.winner)) {
        const winners = {};
        for (const x of found) if (x.winner) winners[x.h] = x.winner.teacherId;
        const ref = addLine({ disciplineId, kind: 'main', semester: null, teacherId: '', responsibleId: responsibleOf(winners, ofDiscipline, pairs) });
        for (const x of found) for (const g of x.groups) (g === x.winner ? place(g, { ref }) : archive(g, x.h));
      } else {
        for (const x of found) {
          const waiting = x.winner ? [x.winner] : x.cands;
          for (const g of x.groups) {
            if (waiting.includes(g)) place(g, { ref: addLine({ disciplineId, kind: 'own', semester: x.h, teacherId: g.teacherId, responsibleId: '' }) });
            else archive(g, x.h);
          }
        }
      }
      continue;
    }

    const main = mainLine(mine, disciplineId);
    const taken = new Set();
    for (const { h, groups } of halves) {
      if (!groups.length) continue;
      const onMain = main ? allSyllabi.filter((s) => s.lineId === main.id && s.semester === h).sort(laterFirst) : [];
      const mainWinner = main && onMain.length === 0 ? winnerOf(groups, leaders).winner : null;
      for (const g of groups) {
        const own = ownLines(mine, disciplineId, h).find((l) => l.teacherId === g.teacherId);
        if (own) place(g, { lineId: own.id });
        else if (main && onMain.length && onMain[0].teacherId === g.teacherId) place(g, { lineId: main.id });
        else if (main && mainWinner === g) place(g, { lineId: main.id });
        else {
          const empty = mine.filter((l) => l.kind === 'archived' && l.semester === h && l.teacherId === g.teacherId && !taken.has(l.id)
            && !allSyllabi.some((s) => s.lineId === l.id)).sort(byCreated)[0] || null;
          if (empty) taken.add(empty.id);
          archive(g, h, empty);
        }
      }
    }
  }

  // the state after the plan: two approved versions of a line in one half leave only the latest approved
  const lineOf = (e) => e.ref ?? e.lineId;
  const finalLines = [...live, ...made.map((l) => ({ ...l, id: l.ref, createdAt: '' }))];
  const finalSyllabi = allSyllabi.map((s) => (placed.has(s.id)
    ? { ...s, lineId: lineOf(placed.get(s.id)), ...(placed.get(s.id).status ? { status: placed.get(s.id).status } : {}) } : s));
  const working = new Set(finalLines.filter((l) => l.kind !== 'archived').map((l) => l.id));
  const approved = new Map();
  for (const s of finalSyllabi) {
    if (s.status !== 'approved' || !working.has(s.lineId)) continue;
    const key = `${s.lineId}|${s.semester}`;
    if (!approved.has(key)) approved.set(key, []);
    approved.get(key).push(s);
  }
  const retireIds = new Set();
  for (const rows of approved.values()) if (rows.length > 1) for (const s of rows.sort(laterFirst).slice(1)) retireIds.add(s.id);
  const retire = allSyllabi.filter((s) => retireIds.has(s.id)).map((s) => s.id);
  const after = finalSyllabi.map((s) => (retireIds.has(s.id) ? { ...s, status: 'archived' } : s));

  const touched = new Set([...byDiscipline.keys(), ...allSyllabi.filter((s) => retireIds.has(s.id)).map((s) => s.disciplineId)]);
  const relay = [];
  if (HALVES.includes(half)) {
    for (const s of arr(subjects)) {
      if (!touched.has(s.disciplineId) || !nonEmpty(s.teacherId)) continue;
      if (versionsOf(allSyllabi, { disciplineId: s.disciplineId, teacherId: s.teacherId, semester: half }).approved) continue;
      const lineId = lineFor(finalLines, { disciplineId: s.disciplineId, teacherId: s.teacherId, semester: half });
      if (lineId && versionsOfLine(after, lineId, half).approved) relay.push(s.id);
    }
  }

  const waiting = [...new Set(finalLines.filter((l) => l.kind === 'own').map((l) => l.disciplineId))].filter((d) => waitingHalves(finalLines, d).length > 0).sort();
  const versions = allSyllabi.filter((s) => placed.has(s.id)).map((s) => placed.get(s.id));
  return { wipe, lines: made, versions, retire, skipped, waiting, relay };
}
