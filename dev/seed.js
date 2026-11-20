import { hashPassword } from '../core/auth.js';

// One password for every fictional person of the dev stand.
export const DEV_PASSWORD = 'journal2026';

const GIVEN = [
  'Aidar', 'Aizada', 'Bakyt', 'Begimai', 'Chyngyz', 'Dinara', 'Eldar', 'Elmira', 'Kanat', 'Meerim', 'Nurlan',
  'Nurzat', 'Ruslan', 'Sezim', 'Talant', 'Ulan', 'Zhyldyz', 'Adilet', 'Gulnara', 'Iskender', 'Kymbat', 'Tilek',
];
const SURNAMES = [
  'Asanov', 'Bekov', 'Chynybekov', 'Duishenov', 'Ermekov', 'Isaev', 'Jumabaev', 'Kasymov', 'Mamytov', 'Orozov',
  'Sadykov', 'Toktogulov', 'Usenov',
];
const GROUPS = [{ name: '01-1', course: 1 }, { name: '02-1', course: 2 }, { name: '03-1', course: 3 }];
const STUDENTS_PER_GROUP = 22;
const STAFF = [
  { login: 'admin', fullName: 'Admin Demo', roles: 'admin' },
  { login: 'dean', fullName: 'Dean Demo', roles: 'dean,teacher' },
  { login: 'prorector', fullName: 'Prorector Demo', roles: 'prorector' },
  { login: 'teacher1', fullName: 'Teacher One', roles: 'teacher' },
  { login: 'teacher2', fullName: 'Teacher Two', roles: 'teacher' },
  { login: 'teacher3', fullName: 'Teacher Three', roles: 'teacher' },
];

// Fills an empty dev store with fictional data. Does nothing when `staff` already has rows.
export function seed(store, platform) {
  if (store.list('staff').length > 0) return;
  // The stored hash carries its own salt, so one hash serves every person.
  const passwordHash = hashPassword(platform, DEV_PASSWORD);
  const common = { passwordHash, mustChangePassword: false, active: true };

  const staff = STAFF.map((person) => store.insert('staff', { ...person, ...common, lang: 'ru' }));
  const teacher1 = staff.find((person) => person.login === 'teacher1');

  GROUPS.forEach((def, g) => {
    const group = store.insert('groups', { name: def.name, course: def.course });
    const students = [];
    for (let i = 0; i < STUDENTS_PER_GROUP; i++) {
      const cardNo = `S${def.course}${String(i + 1).padStart(3, '0')}`;
      const number = g * STUDENTS_PER_GROUP + i;
      students.push({
        fullName: `${SURNAMES[(number * 5 + g) % SURNAMES.length]} ${GIVEN[number % GIVEN.length]}`,
        groupId: group.id,
        cardNo,
        ...common,
        mustChangePassword: cardNo === 'S1002',
        lang: 'ky',
      });
    }
    store.insertMany('students', students);
    store.insert('subjects', { name: 'Информатика', teacherId: teacher1.id, groupId: group.id, scheme: 'A' });
  });

  for (const name of ['101', '204', '305']) store.insert('rooms', { name });
}
