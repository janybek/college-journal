// Puts the stored syllabi on the syllabus of the discipline at the start of a server (the plan is disciplineMigration of core/disciplineSyllabus.js):
// the old versions (without a line) join the line of their discipline or an old «own» / history line, the rows of the shared lines of the earlier build
// (without a kind) are wiped, a second approved version of one line and half goes to the archive. The future pairs of the groups that now follow another syllabus
// are laid again. Nothing is read beyond «Силлабусы» and «Силлабусы дисциплин», and nothing is written, when everything is in its place.
// A break between two writes (a store without transactions) is mended by the next start: the plan is the same and the rest is done.
// No Node or Apps Script objects here.
import { localDateTime } from '../core/dates.js';
import { disciplineMigration } from '../core/disciplineSyllabus.js';
import { loadSettings, relayout } from './scheduleData.js';

// -> { lines: lines made, skipped: versions with no discipline, teacher or half of the year (they stay as they were),
//      waiting: disciplines that wait for the choice of the deanery, relaid: pairs whose lesson changed }
export function applyLinesUpgrade(store, platform) {
  const syllabi = store.list('syllabi');
  const lines = store.list('syllabusLines');
  const quick = disciplineMigration({ syllabi, lines, subjects: [], pairs: [] });
  if (quick.wipe.length === 0 && quick.lines.length === 0 && quick.versions.length === 0 && quick.retire.length === 0) {
    return { lines: 0, skipped: 0, waiting: 0, relaid: 0 };
  }

  const subjects = store.list('subjects');
  const pairs = store.list('pairs');
  const topics = store.list('topics');
  const settings = loadSettings(store);
  const plan = disciplineMigration({ syllabi, lines, subjects, pairs, half: settings.semester });
  const at = localDateTime(platform.now());
  let relaid = 0;

  const run = () => {
    if (plan.wipe.length > 0) store.removeMany('syllabusLines', plan.wipe);
    const made = plan.lines.length > 0
      ? store.insertMany('syllabusLines', plan.lines.map((l) => ({
        disciplineId: l.disciplineId, kind: l.kind, semester: l.semester, teacherId: l.teacherId, responsibleId: l.responsibleId,
        dueDate: '', reviewDue: '', createdBy: '', createdAt: at,
      })))
      : [];
    const idOf = new Map(plan.lines.map((l, i) => [l.ref, made[i].id]));
    const patches = new Map();
    for (const v of plan.versions) patches.set(v.id, { lineId: v.ref ? idOf.get(v.ref) : v.lineId, ...(v.status ? { status: v.status } : {}) });
    for (const id of plan.retire) patches.set(id, { ...patches.get(id), status: 'archived' });
    const after = syllabi.map((s) => (patches.has(s.id) ? { ...s, ...patches.get(s.id) } : s));
    if (plan.relay.length > 0) {
      const gone = new Set(plan.wipe);
      const result = relayout(store, plan.relay, { subjects, syllabi: after, syllabusLines: [...lines.filter((l) => !gone.has(l.id)), ...made], topics, pairs, settings }, []);
      relaid = result.changed;
    }
    if (patches.size > 0) store.updateMany('syllabi', [...patches].map(([id, patch]) => ({ id, patch })));
  };
  if (typeof store.transaction === 'function') store.transaction(run);
  else run();
  return { lines: plan.lines.length, skipped: plan.skipped.length, waiting: plan.waiting.length, relaid };
}
