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
  // #/dir/<groups|rooms|disciplines>/<id>/edit: the edit window of a record; #/dir/students/group/<groupId>: the students of a group.
  const edit = /^\/dir\/(groups|rooms|disciplines)\/([^/]+)\/edit$/.exec(path);
  if (edit && permissions.includes('dir.save:' + edit[1]) && idOf(edit[2]) !== null) return { view: 'directory', params: { table: edit[1], editId: idOf(edit[2]) } };
  const studentsOf = /^\/dir\/students\/group\/([^/]+)$/.exec(path);
  if (studentsOf && permissions.includes('dir.list:students') && idOf(studentsOf[1]) !== null) return { view: 'directory', params: { table: 'students', groupId: idOf(studentsOf[1]) } };
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
  // #/schedule/group/<groupId>: the week of that group; #/journal/group/<groupId>: the journals, that group chosen.
  const scheduleOf = /^\/schedule\/group\/([^/]+)$/.exec(path);
  if (scheduleOf && permissions.includes('schedule.list') && idOf(scheduleOf[1]) !== null) return { view: 'schedule', params: { groupId: idOf(scheduleOf[1]) } };
  const journalsOf = /^\/journal\/group\/([^/]+)$/.exec(path);
  if (journalsOf && permissions.includes('journal.list') && idOf(journalsOf[1]) !== null) return { view: 'journalList', params: { groupId: idOf(journalsOf[1]) } };
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
  // «Ведомости»: the list; #/ledger/<subjectId>: the ledger of a subject (semester points, admission, exam). The server checks every right itself.
  if (path === '/ledger' && permissions.includes('ledger.list')) return { view: 'ledgerList', params: {} };
  const ledger = /^\/ledger\/([^/]+)$/.exec(path);
  if (ledger && permissions.includes('ledger.get') && idOf(ledger[1]) !== null) return { view: 'ledger', params: { subjectId: idOf(ledger[1]) } };
  // «Задания»: the subjects with their assignments (teacher, office) or the student's own list; #/tasks/<subjectId>: the
  // assignments of a subject; #/task/<assignmentId>: one assignment. The server checks every right itself.
  if (path === '/tasks' && (permissions.includes('work.overview') || permissions.includes('work.mine'))) return { view: 'tasks', params: {} };
  const tasks = /^\/tasks\/([^/]+)$/.exec(path);
  if (tasks && permissions.includes('work.list') && idOf(tasks[1]) !== null) return { view: 'tasks', params: { subjectId: idOf(tasks[1]) } };
  const task = /^\/task\/([^/]+)$/.exec(path);
  if (task && permissions.includes('work.get') && idOf(task[1]) !== null) return { view: 'task', params: { assignmentId: idOf(task[1]) } };
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
  // «Заявки»: the requests of a teacher to correct closed data (request.mine); the deanery's queue (request.queue) comes to the same address.
  if (path === '/requests' && (permissions.includes('request.mine') || permissions.includes('request.queue'))) return { view: 'requests', params: {} };
  // «Повторный курс»: the list; #/repeat/<id>: one card. The server checks every right itself (the teacher of the repeat sees only own cards).
  if (path === '/repeats' && permissions.includes('repeat.list')) return { view: 'repeats', params: {} };
  const repeat = /^\/repeat\/([^/]+)$/.exec(path);
  if (repeat && permissions.includes('repeat.get') && idOf(repeat[1]) !== null) return { view: 'repeat', params: { repeatId: idOf(repeat[1]) } };
  // «Гос. экзамены»: the list; #/state-exam/<examId>: the sheet of one exam (the deanery enters the scores, the others read). The server checks every right itself.
  if (path === '/state-exams' && permissions.includes('stateExam.list')) return { view: 'stateExams', params: {} };
  const stateExam = /^\/state-exam\/([^/]+)$/.exec(path);
  if (stateExam && permissions.includes('stateExam.get') && idOf(stateExam[1]) !== null) return { view: 'stateExam', params: { examId: idOf(stateExam[1]) } };
  // «Объявления»: what the person may read (and, for the teachers and the deanery, write). The server decides who sees which.
  if (path === '/announcements' && permissions.includes('announce.list')) return { view: 'announcements', params: {} };
  if (path === '/settings' && permissions.includes('settings.get')) return { view: 'settings', params: {} };
  if (path === '/my' && permissions.includes('schedule.mine')) return { view: 'mySchedule', params: {} };
  // «Я на паре»: the check-in of a student (a pass from a QR link also lands here).
  if (path === '/here' && permissions.includes('checkin.mark')) return { view: 'checkin', params: {} };
  return { view: 'home', params: {} };
}
