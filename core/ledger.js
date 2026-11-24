// Ledger rules: which units are closed and what stops a closing.
// Pure functions: the semester points and the admission come from the journal (core/grades.js).

export const FINAL_UNIT = 0;

function active(closures, subjectId, planSemester) {
  if (!Array.isArray(closures)) return [];
  const sem = planSemester ?? null;
  return closures.filter((c) => c.subjectId === subjectId && (c.planSemester ?? null) === sem && c.reopenedAt === '');
}

function newer(a, b) {
  if (a.closedAt !== b.closedAt) return a.closedAt > b.closedAt;
  return a.id > b.id;
}

export function activeClosure(closures, subjectId, planSemester, unit) {
  let best = null;
  for (const c of active(closures, subjectId, planSemester)) {
    if (c.unit === unit && (!best || newer(c, best))) best = c;
  }
  return best;
}

export function closedUnitsOf(closures, subjectId, planSemester) {
  const units = new Set();
  let final = false;
  for (const c of active(closures, subjectId, planSemester)) {
    if (c.unit === FINAL_UNIT) final = true;
    else units.add(c.unit);
  }
  return { units: [...units].sort((a, b) => a - b), final };
}

export function closeProblems({ unit, pairs, students, results }) {
  const blocking = [];
  const notHeld = (pairs || []).filter((p) => p.unit === unit && (p.status === 'planned' || p.status === 'running')).length;
  if (notHeld > 0) blocking.push({ code: 'pairs_not_held', n: notHeld });
  let pending = 0;
  let missing = 0;
  for (const s of students || []) {
    if (s.left) continue;
    const row = ((results && results[s.id] && results[s.id].units) || []).find((u) => u.unit === unit);
    if (row && row.selfWork && row.selfWork.pending > 0) pending += 1;
    if (!row || row.total === null || row.total === undefined) missing += 1;
  }
  if (pending > 0) blocking.push({ code: 'self_pending', n: pending });
  return { blocking, missing };
}
