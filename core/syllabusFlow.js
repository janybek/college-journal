// Versions of a syllabus and what may be done with them. No storage, no network.
import { OPEN_STATUSES } from './schema.js';

// The greater version wins, then the greater id: two matching rows (two simultaneous «Fill» on Google) give one answer.
const later = (a, b) => (!a || b.version > a.version || (b.version === a.version && b.id > a.id) ? b : a);

// The versions of one key «discipline + teacher + half of the year» -> { approved, open, last }.
// approved: the row with status 'approved'; open: the row with a status of OPEN_STATUSES (rows or null); last: the greatest version number (0: none).
export function versionsOf(syllabi, { disciplineId, teacherId, semester }) {
  let approved = null;
  let open = null;
  let last = 0;
  for (const s of syllabi || []) {
    if (s.disciplineId !== disciplineId || s.teacherId !== teacherId || s.semester !== semester) continue;
    last = Math.max(last, Number(s.version) || 0);
    if (s.status === 'approved') approved = later(approved, s);
    else if (OPEN_STATUSES.includes(s.status)) open = later(open, s);
  }
  return { approved, open, last };
}
