// Puts the stored syllabi on lines at the start of a server: each old version (without lineId) joins the line of its teacher,
// a teacher without a line gets one of his own. Nothing is read or written when every version already has its line.
// No Node or Apps Script objects here.
import { localDateTime } from '../core/dates.js';
import { linesMigration } from '../core/syllabusLines.js';

// -> { lines: how many lines were made, skipped: how many versions have no discipline, teacher or half of the year and stay as they were }
export function applyLinesUpgrade(store, platform) {
  const syllabi = store.list('syllabi');
  if (!syllabi.some((s) => !s.lineId)) return { lines: 0, skipped: 0 };
  const { groups, skipped } = linesMigration(syllabi, store.list('syllabusLines'), store.list('syllabusMembers'));
  const at = localDateTime(platform.now());
  const fresh = groups.filter((g) => g.lineId === null);
  const run = () => {
    const made = fresh.length > 0
      ? store.insertMany('syllabusLines', fresh.map((g) => ({ disciplineId: g.key.disciplineId, semester: g.key.semester, authorId: g.key.teacherId, createdBy: '', createdAt: at })))
      : [];
    const lineOf = new Map(fresh.map((g, i) => [g, made[i].id]));
    const members = groups.filter((g) => g.member !== null).map((g) => ({
      lineId: lineOf.get(g), disciplineId: g.key.disciplineId, semester: g.key.semester, teacherId: g.key.teacherId, state: g.member, byId: '',
      invitedAt: '', joinedAt: at, endedAt: g.member === 'left' ? at : '', endedBy: '',
    }));
    if (members.length > 0) store.insertMany('syllabusMembers', members);
    const patches = groups.flatMap((g) => g.versionIds.map((id) => ({ id, patch: { lineId: g.lineId ?? lineOf.get(g) } })));
    if (patches.length > 0) store.updateMany('syllabi', patches);
  };
  if (typeof store.transaction === 'function') store.transaction(run);
  else run();
  return { lines: fresh.length, skipped: skipped.length };
}
