import { DIR_TABLES } from './views/directoryConfig.js';
import { tabOf } from './syllabusForm.js';

// Maps the address (#/...) and the signed-in user to a screen. Pure: no DOM, no storage.
// Tables such as weekTemplate are listed through dir.* too, but have screens of their own:
// only the directories of DIR_TABLES open on the directory screen.
// The id from an address part: URI-decoded; a broken escape (%E0%A4%A) gives null, and the address is not found.
function idOf(raw) {
  try { return decodeURIComponent(raw); } catch (error) { return null; }
}

export function resolveRoute(hash, user) {
  if (!user) return { view: 'login', params: {} };
  if (user.mustChangePassword === true) return { view: 'changePassword', params: {} };
  const path = String(hash ?? '').replace(/^#/, '');
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const dir = /^\/dir\/([^/]+)$/.exec(path);
  if (dir && DIR_TABLES.includes(dir[1]) && permissions.includes('dir.list:' + dir[1])) return { view: 'directory', params: { table: dir[1] } };
  if (path === '/import' && permissions.some((p) => p.startsWith('import.apply:'))) return { view: 'import', params: {} };
  // #/syllabus/<subjectId>, #/syllabus/<subjectId>/<1|2>: the syllabus of a subject, in that semester of the year;
  // #/syllabus/<subjectId>/<1|2>/draft: its new version (the open one), not yet approved.
  const syllabus = /^\/syllabus\/([^/]+)(?:\/([12])(\/draft)?)?$/.exec(path);
  if (syllabus && permissions.includes('syllabus.get')) {
    const params = { subjectId: syllabus[1] };
    if (syllabus[2]) params.semester = Number(syllabus[2]);
    if (syllabus[3]) params.version = 'open';
    return { view: 'syllabus', params };
  }
  // #/syllabus-form/<syllabusId>, #/syllabus-form/<syllabusId>/<tab>: the form of a syllabus version, on that tab.
  const form = /^\/syllabus-form\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (form && permissions.includes('syllabus.form')) return { view: 'syllabusForm', params: { syllabusId: form[1], tab: tabOf(form[2]) } };
  if (path === '/schedule' && permissions.includes('schedule.list')) return { view: 'schedule', params: {} };
  // «Предметы» of the deanery: who teaches what and whose syllabus. Subjects are no longer an ordinary directory.
  if (path === '/subjects' && permissions.includes('subjects.overview')) return { view: 'subjects', params: {} };
  // «Силлабусы на утверждении»: the versions sent to the deanery.
  if (path === '/review' && permissions.includes('syllabus.queue')) return { view: 'review', params: {} };
  // #/template, #/template/<groupId>, #/template/<groupId>/<weekday 1–5>: the group to show and the day to mark.
  const template = /^\/template(?:\/([^/]+)(?:\/([1-5]))?)?$/.exec(path);
  if (template && permissions.includes('dir.list:weekTemplate')) {
    const params = {};
    if (template[1]) params.groupId = template[1];
    if (template[2]) params.weekday = Number(template[2]);
    return { view: 'weekTemplate', params };
  }
  // «Журналы»: the list; #/journal/<subjectId>: the journal of a subject.
  if (path === '/journal' && permissions.includes('journal.list')) return { view: 'journalList', params: {} };
  const journal = /^\/journal\/([^/]+)$/.exec(path);
  if (journal && permissions.includes('journal.get') && idOf(journal[1]) !== null) return { view: 'journal', params: { subjectId: idOf(journal[1]) } };
  // #/lesson/<pairId>: the screen of a started pair for the projector (the server lets in only its teacher).
  const lesson = /^\/lesson\/([^/]+)$/.exec(path);
  if (lesson && permissions.includes('lesson.get') && idOf(lesson[1]) !== null) return { view: 'lesson', params: { pairId: idOf(lesson[1]) } };
  // «Журнал изменений»: the whole log is for the admin, the deanery and the vice-rector; the log of one subject also for its teacher.
  const office = Array.isArray(user.roles) && user.roles.some((role) => ['admin', 'dean', 'prorector'].includes(role));
  if (path === '/journal-log' && office && permissions.includes('journal.log')) return { view: 'journalLog', params: {} };
  const log = /^\/journal-log\/([^/]+)$/.exec(path);
  if (log && permissions.includes('journal.log') && idOf(log[1]) !== null) return { view: 'journalLog', params: { subjectId: idOf(log[1]) } };
  // «Оценки» of a student: all subjects; #/grades/<subjectId>: one of them (the screen looks it up in its own answer).
  if (path === '/grades' && permissions.includes('student.grades')) return { view: 'grades', params: {} };
  const grades = /^\/grades\/([^/]+)$/.exec(path);
  if (grades && permissions.includes('student.grades') && idOf(grades[1]) !== null) return { view: 'grades', params: { subjectId: idOf(grades[1]) } };
  if (path === '/settings' && permissions.includes('settings.get')) return { view: 'settings', params: {} };
  if (path === '/my' && permissions.includes('schedule.mine')) return { view: 'mySchedule', params: {} };
  return { view: 'home', params: {} };
}
