// 'dir.people' and 'dir.person': the people of the directories (students and staff) with their progress. Read-only.
import { AppError } from '../core/errors.js';
import { isDate } from '../core/dates.js';
import { PERSON_TABLES } from '../core/progress.js';
import { staffCard, staffList } from './dirStaff.js';
import { studentCard, studentsList } from './dirStudents.js';

function tableOf(table) {
  if (typeof table !== 'string' || !PERSON_TABLES.includes(table)) throw new AppError('bad_request');
  return table;
}

export function dirPeople(store, platform, user, table) {
  return tableOf(table) === 'students' ? studentsList(store, platform, user) : staffList(store, platform, user);
}

export function dirPerson(store, platform, user, data) {
  const input = data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const table = tableOf(input.table);
  if (typeof input.id !== 'string' || input.id === '') throw new AppError('bad_request');
  if (table === 'students') return studentCard(store, platform, user, input.id);
  if (input.from !== undefined && !isDate(input.from)) throw new AppError('bad_request');
  return staffCard(store, platform, user, input.id, input.from);
}
