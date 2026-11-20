export const STAFF_ROLES = ['admin', 'dean', 'prorector', 'teacher'];
export const LANGS = ['ky', 'ru', 'en'];
export const DEFAULT_LANG = 'ky';

const col = (key, title, type = 'string') => ({ key, title, type });

export const SCHEMA = {
  groups: {
    sheet: 'Группы', prefix: 'g',
    columns: [col('id', 'id'), col('name', 'название'), col('course', 'курс', 'int')],
  },
  students: {
    sheet: 'Студенты', prefix: 'st',
    columns: [
      col('id', 'id'), col('fullName', 'ФИО'), col('groupId', 'группа'), col('cardNo', '№ студ. билета'),
      col('passwordHash', 'хэш пароля'), col('lang', 'язык'),
      col('mustChangePassword', 'сменить пароль', 'bool'), col('active', 'активен', 'bool'),
    ],
  },
  staff: {
    sheet: 'Сотрудники', prefix: 'sf',
    columns: [
      col('id', 'id'), col('fullName', 'ФИО'), col('login', 'логин'), col('passwordHash', 'хэш пароля'),
      col('roles', 'роли'), col('lang', 'язык'),
      col('mustChangePassword', 'сменить пароль', 'bool'), col('active', 'активен', 'bool'),
    ],
  },
  subjects: {
    sheet: 'Предметы', prefix: 'sb',
    columns: [
      col('id', 'id'), col('name', 'название'), col('teacherId', 'преподаватель'),
      col('groupId', 'группа'), col('scheme', 'схема оценивания'),
    ],
  },
  rooms: {
    sheet: 'Аудитории', prefix: 'r',
    columns: [col('id', 'id'), col('name', 'название')],
  },
  translations: {
    sheet: 'Переводы', prefix: 'tr',
    columns: [
      col('id', 'id'), col('key', 'ключ'), col('ky', 'кыргызский'),
      col('ru', 'русский'), col('en', 'английский'),
    ],
  },
  settings: {
    sheet: 'Настройки', prefix: 'cfg',
    columns: [col('id', 'id'), col('key', 'ключ'), col('value', 'значение')],
  },
};

export function tableNames() {
  return Object.keys(SCHEMA);
}
