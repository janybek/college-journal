import { SCHEMA } from '../../core/schema.js';
import { hashPassword, generateTempPassword, TEMP_HASH_ROUNDS } from '../../core/auth.js';
import { normalizeRow } from '../../core/validate.js';
import { handleRequest } from '../api.js';
import { createSheetsStore, ensureSheets } from '../store/sheetsStore.js';
import { createGasPlatform } from '../platform/gasPlatform.js';
import { linkSubjects } from '../subjectData.js';

// Apps Script entry points. Apps Script globals (SpreadsheetApp, ContentService, ...) are used directly.

const SPREADSHEET_NAME = 'Журнал колледжа — база';
const LOCK_WAIT_MS = 10000;
const TIME_ZONE = 'Asia/Bishkek';
const LOCALE = 'ru_RU';
const DEFAULT_SHEET_NAMES = ['Лист1', 'Sheet1'];

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// Whole-store operations run one at a time under the script lock.
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

export function doGet() {
  return jsonOutput({ ok: true, data: 'journal' });
}

export function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const platform = createGasPlatform();
    const spreadsheetId = props.getProperty('SPREADSHEET_ID');
    if (!spreadsheetId || !props.getProperty('SECRET')) {
      return jsonOutput({ ok: false, error: { code: 'not_configured' }, serverTime: platform.now() });
    }
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const store = createSheetsStore(SCHEMA, platform, spreadsheet, withLock);
    const raw = e && e.postData ? e.postData.contents : '';
    return jsonOutput(handleRequest(raw, { store, platform, log: (error) => console.error(error) }));
  } catch (error) {
    console.error(error);
    return jsonOutput({ ok: false, error: { code: 'internal' } });
  }
}

// The new spreadsheet comes with an empty default sheet that is not ours.
function removeDefaultSheet(spreadsheet) {
  const ours = Object.keys(SCHEMA).map((table) => SCHEMA[table].sheet);
  const sheets = spreadsheet.getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (spreadsheet.getSheets().length > 1 && DEFAULT_SHEET_NAMES.includes(name)
      && !ours.includes(name) && sheet.getLastRow() === 0) {
      spreadsheet.deleteSheet(sheet);
    }
  }
}

// One-button setup: creates the spreadsheet, the secret and the first administrator. Safe to repeat.
export function setup() {
  const props = PropertiesService.getScriptProperties();
  const platform = createGasPlatform();

  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(SPREADSHEET_NAME);
    spreadsheetId = spreadsheet.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  }
  // Dates typed into the sheet must mean Bishkek midnight, whoever created the file.
  spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
  spreadsheet.setSpreadsheetLocale(LOCALE);
  ensureSheets(SCHEMA, spreadsheet);
  removeDefaultSheet(spreadsheet);

  if (!props.getProperty('SECRET')) props.setProperty('SECRET', platform.randomHex(32));

  const store = createSheetsStore(SCHEMA, platform, spreadsheet, withLock);
  let adminTempPassword = null;
  if (store.list('staff').length === 0) {
    adminTempPassword = generateTempPassword(platform);
    store.insert('staff', normalizeRow('staff', {
      fullName: 'Администратор',
      login: 'admin',
      passwordHash: hashPassword(platform, adminTempPassword, undefined, TEMP_HASH_ROUNDS),
      roles: 'admin',
      lang: 'ru',
      mustChangePassword: true,
      active: true,
    }));
  }

  // Subjects made before the disciplines directory get their discipline; nameless ones stay and are counted.
  const { unlinked } = linkSubjects(store);

  const result = { spreadsheetUrl: spreadsheet.getUrl(), adminLogin: 'admin', adminTempPassword, unlinkedSubjects: unlinked };
  Logger.log(JSON.stringify(result));
  return result;
}
