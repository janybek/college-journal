import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from '../../core/schema.js';
import { generateTempPassword } from '../../core/auth.js';
import { localDate } from '../../core/dates.js';
import { openBase } from './base.js';
import { verifyCopy } from './backup.js';
import { isOurSupervisor, answers } from './supervisor.js';
import { FILES_DIR, createDiskFiles, mirrorFiles } from './files.js';

// The demo data of the working base: the fictional people and data of the stand, with Cyrillic names and one random password
// that goes only into a file in the alert folder. Node only: this file is not bundled for Apps Script.
export const PASSWORD_FILE = 'Журнал — пробные пароли.txt';
export const DEMO_EXIT = { ok: 0, crash: 1, config: 2 };

const clockNow = () => new Date().getTime();
const readJson = (file) => {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
};

// Every table except one administrator must be empty. initBase puts nothing else into a new base.
export function baseIsEmpty(db) {
  for (const table of Object.keys(SCHEMA)) {
    const n = db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;
    if (table === 'staff') {
      const rows = db.prepare('SELECT "login" FROM "staff"').all();
      if (rows.length > 1 || (rows.length === 1 && rows[0].login !== 'admin')) return false;
    } else if (n > 0) {
      return false;
    }
  }
  return true;
}

// Deletes every row of every table of the schema except the administrator. Returns [[table, count]] of what was erased.
function wipeBase(db) {
  const erased = [];
  for (const table of Object.keys(SCHEMA)) {
    const result = table === 'staff' ? db.prepare(`DELETE FROM "staff" WHERE "login" <> 'admin'`).run() : db.prepare(`DELETE FROM "${table}"`).run();
    if (result.changes > 0) erased.push([table, Number(result.changes)]);
  }
  return erased;
}

// A checked copy under a name of its own: the daily copy of the same date is rewritten by the next start of the server and must not take the demo data.
function copyBefore(db, config, now) {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stem = `journal-before-demo-${localDate(now())}`;
  let file = path.join(config.backupDir, `${stem}.sqlite`);
  for (let n = 2; fs.existsSync(file); n += 1) file = path.join(config.backupDir, `${stem}-${n}.sqlite`);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.rmSync(tmp, { force: true });
    db.prepare('VACUUM INTO ?').run(tmp);
    verifyCopy(tmp, Object.keys(SCHEMA));
    fs.renameSync(tmp, file);
    return file;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function passwordText(password) {
  return [
    'Пробные люди журнала (вымышленные, для показа коллегам)',
    `Пароль у всех один: ${password}`,
    '',
    'Логины:',
    '  dean - деканат (и преподаватель)',
    '  prorector - проректор',
    '  teacher1, teacher2, teacher3 - преподаватели',
    '  S1001...S1022 (группа 01-1), S2001...S2022 (группа 02-1), S3001...S3022 (группа 03-1) - студенты',
    '',
    'Это вымышленные люди для показа; удалите файл после очистки базы.',
    '',
  ].join('\r\n');
}

// Returns { code }. The caller has checked nothing: the stop of the server, the settings, the empty base are all checked here.
export async function runDemo(config, { out = console.log, now, logger, wipe = false }) {
  const clock = now ?? clockNow;
  // dev/ is not in the container image: it is loaded here, not at the start of the server, so the server starts without it
  let seedDemo;
  try {
    ({ seedDemo } = await import('../../dev/seed.js'));
  } catch (error) {
    out('Пробные данные недоступны: в этой установке нет папки dev. Ничего не изменено');
    return { code: DEMO_EXIT.config };
  }
  if (!config.alertDir) {
    out('Не указана папка тревог (alertDir) в настройках: пароль пробных людей некуда записать. Ничего не изменено');
    return { code: DEMO_EXIT.config };
  }
  // the same check as the restore: a running server or its supervisor would meet the new rows half way
  if (isOurSupervisor(readJson(config.supervisorFile)) || (await answers(readJson(config.stateFile)?.port))) {
    out('Сначала остановите сервер: npm run serve:stop');
    return { code: DEMO_EXIT.config };
  }
  const base = openBase(config, { now });
  const passwordFile = path.join(config.alertDir, PASSWORD_FILE);
  let wroteFile = false;
  try {
    base.upgrade();
    if (wipe) {
      const admins = base.db.prepare(`SELECT count(*) AS n FROM "staff" WHERE "login" = 'admin'`).get().n;
      if (admins !== 1) {
        out('В базе нет администратора (admin): ничего не изменено');
        return { code: DEMO_EXIT.config };
      }
    } else if (!baseIsEmpty(base.db)) {
      out('В базе уже есть данные - пробные данные заливаются только в пустую базу');
      return { code: DEMO_EXIT.config };
    }
    if (fs.existsSync(passwordFile)) {
      out(`Файл ${passwordFile} уже есть: удалите его (он остался от прежних пробных данных) и повторите. Ничего не изменено`);
      return { code: DEMO_EXIT.config };
    }
    let copy;
    try {
      copy = copyBefore(base.db, config, clock);
    } catch (error) {
      out(`Копия базы не сделана (${String(error?.message || error).replace(/[\r\n]+/g, ' ')}): ничего не изменено`);
      return { code: DEMO_EXIT.crash };
    }
    // the wipe leaves the files of the erased rows on the disk for the sweep: the mirror keeps them before that
    if (wipe && config.filesDir) {
      try {
        mirrorFiles(config.filesDir, path.join(config.backupDir, FILES_DIR));
      } catch (error) {
        out(`Копия файлов не сделана (${String(error?.message || error).replace(/[\r\n]+/g, ' ')}): ничего не изменено`);
        return { code: DEMO_EXIT.crash };
      }
    }
    // two temporary passwords in a row: 16 letters and digits
    const password = `${generateTempPassword(base.platform)}-${generateTempPassword(base.platform)}`;
    try {
      fs.mkdirSync(config.alertDir, { recursive: true });
      fs.writeFileSync(passwordFile, passwordText(password), { flag: 'wx' });
      wroteFile = true;
    } catch (error) {
      out(`Файл с паролем не записан в ${config.alertDir}: ничего не изменено`);
      return { code: DEMO_EXIT.config };
    }
    // the file is there before the people: people without a known password are worse than a file without people
    let erased = [];
    const ok = base.store.transaction(() => {
      if (wipe) erased = wipeBase(base.db);
      const done = seedDemo(base.store, base.platform, { password, files: config.filesDir ? createDiskFiles(config.filesDir) : null });
      if (wipe && !done) throw new Error('the demo data are not added after the wipe');       // rolls the wipe back too
      return done;
    });
    if (!ok) {
      fs.rmSync(passwordFile, { force: true });
      out('В базе уже есть данные - пробные данные заливаются только в пустую базу');
      return { code: DEMO_EXIT.config };
    }
    wroteFile = false;
    const total = erased.reduce((sum, [, n]) => sum + n, 0);
    if (wipe) out(`Стёрто строк: ${total}${total > 0 ? ' (' + erased.map(([table, n]) => `${table}: ${n}`).join(', ') + ')' : ''}`);
    logger?.info(wipe ? `demo data added (wiped ${total} rows)` : 'demo data added');
    out(`Пробные данные залиты; пароль записан в файл ${passwordFile}`);
    out(`Копия базы до заливки: ${copy}`);
    return { code: DEMO_EXIT.ok };
  } catch (error) {
    if (wroteFile) fs.rmSync(passwordFile, { force: true });
    throw error;
  } finally {
    base.close();
  }
}
