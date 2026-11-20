// What the directory and import screens show for each directory. Pure data: no DOM, no requests,
// so tests can read it in Node.

// Directories in menu order.
export const DIR_TABLES = ['groups', 'students', 'staff', 'subjects', 'rooms'];

// Import choices in the order they should be filled: a list can only refer to directories loaded before it.
export const IMPORT_TABLES = ['groups', 'rooms', 'staff', 'students', 'subjects', 'topics'];

export const STAFF_ROLES = ['admin', 'dean', 'prorector', 'teacher'];

const col = (key, required) => ({ key, required });

// Columns of the import template. The site cannot load core/import.js, so this copies IMPORT_SPECS;
// tests/i18n.test.js checks that both stay equal.
export const IMPORT_COLUMNS = {
  groups: [col('name', true), col('course', true)],
  rooms: [col('name', true)],
  students: [col('fullName', true), col('cardNo', true), col('groupId', true), col('lang', false)],
  staff: [col('fullName', true), col('login', true), col('roles', true), col('lang', false)],
  subjects: [col('name', true), col('teacherId', true), col('groupId', true)],
  topics: [col('subjectId', true), col('groupId', true), col('unit', true), col('order', true), col('name', true), col('lessonType', true)],
};

// How a field is edited. A key means the same thing in every directory (and in the topics of a subject).
// kind: text | number | group | teacher | lang | roles | active. The import template formats every column whose
// kind is not `number` as Text. `id`: an identifier people type
// (no autocorrect, shown in a monospace face). `existingOnly`: shown only when editing a saved record.
export const FIELDS = {
  name: { kind: 'text', required: true, maxLength: 200 },
  course: { kind: 'number', required: true, min: 1, max: 6 },
  fullName: { kind: 'text', required: true, maxLength: 200 },
  cardNo: { kind: 'text', required: true, maxLength: 200, id: true },
  login: { kind: 'text', required: true, maxLength: 40, id: true },
  groupId: { kind: 'group', required: true },
  teacherId: { kind: 'teacher', required: true },
  lang: { kind: 'lang' },
  roles: { kind: 'roles' },
  active: { kind: 'active', existingOnly: true },
  // Topics: the subject is named in the file and chosen on the screen; the type is one of LESSON_TYPES.
  subjectId: { kind: 'text', required: true },
  lessonType: { kind: 'text', required: true },
  unit: { kind: 'number', required: true, min: 1, max: 12 },
  order: { kind: 'number', required: true, min: 1, max: 200 },
};

// label: the field that names a record (dialog titles, confirmations, sorting).
// login: the field a person signs in with. refs: other directories whose names the table shows.
export const DIRECTORIES = {
  groups: { label: 'name', columns: ['name', 'course'], form: ['name', 'course'], refs: [] },
  students: {
    label: 'fullName', login: 'cardNo', refs: ['groups'], groupFilter: true,
    columns: ['fullName', 'groupId', 'cardNo', 'lang'],
    form: ['fullName', 'cardNo', 'groupId', 'lang', 'active'],
  },
  staff: {
    label: 'fullName', login: 'login', refs: [],
    columns: ['fullName', 'login', 'roles', 'lang'],
    form: ['fullName', 'login', 'roles', 'lang', 'active'],
  },
  subjects: {
    label: 'name', refs: ['staff', 'groups'],
    columns: ['name', 'teacherId', 'groupId'],
    form: ['name', 'teacherId', 'groupId'],
  },
  rooms: { label: 'name', columns: ['name'], form: ['name'], refs: [] },
};
