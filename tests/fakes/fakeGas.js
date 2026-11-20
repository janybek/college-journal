import { createHash, createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createFakeSpreadsheet } from './fakeSpreadsheet.js';

// Fake of the Apps Script globals the backend uses. Mimics the quirks that matter:
// digest bytes are SIGNED (-128..127), HMAC takes (value, key), a new spreadsheet has a default sheet,
// the last sheet cannot be deleted, the script lock must be released.
const signed = (buffer) => Array.from(buffer, (b) => (b > 127 ? b - 256 : b));

const UTF_8 = 'UTF_8';
const SHA_256 = 'SHA_256';

export function createFakeGas() {
  const logs = [];
  const properties = new Map();
  const spreadsheets = new Map();
  const lockCalls = { waits: [], releases: 0 };
  let lockHeld = false;
  let counter = 0;

  const checkText = (value, charset) => {
    if (typeof value !== 'string') throw new Error('Expected a string value');
    if (charset !== undefined && charset !== UTF_8) throw new Error('Unsupported charset');
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256 },
    Charset: { UTF_8 },
    computeDigest(algorithm, value, charset) {
      if (algorithm !== SHA_256) throw new Error('Unsupported digest algorithm');
      checkText(value, charset);
      return signed(createHash('sha256').update(value, 'utf8').digest());
    },
    computeHmacSha256Signature(value, key, charset) {
      checkText(value, charset);
      checkText(key, charset);
      return signed(createHmac('sha256', key).update(value, 'utf8').digest());
    },
    getUuid: () => randomUUID(),
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (name) => (properties.has(name) ? properties.get(name) : null),
      setProperty(name, value) { properties.set(name, String(value)); },
    }),
  };

  const wrapSpreadsheet = (id) => {
    const inner = createFakeSpreadsheet({ 'Лист1': [] }, { 'Лист1': { maxRows: 1000, maxColumns: 26 } });
    return Object.assign(inner, {
      getId: () => id,
      getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
    });
  };

  const SpreadsheetApp = {
    create(name) {
      counter += 1;
      const id = `fake-spreadsheet-${counter}`;
      const spreadsheet = wrapSpreadsheet(id);
      spreadsheet.getName = () => name;
      spreadsheets.set(id, spreadsheet);
      return spreadsheet;
    },
    openById(id) {
      const spreadsheet = spreadsheets.get(id);
      if (!spreadsheet) throw new Error(`Unexpected error while getting the method or property openById on object SpreadsheetApp.`);
      return spreadsheet;
    },
  };

  const ContentService = {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput(text) {
      const output = {
        mimeType: null,
        setMimeType(mime) { output.mimeType = mime; return output; },
        getMimeType: () => output.mimeType,
        getContent: () => text,
      };
      return output;
    },
  };

  const LockService = {
    getScriptLock: () => ({
      waitLock(ms) {
        if (lockHeld) throw new Error('Lock timeout: the lock is already held');
        lockCalls.waits.push(ms);
        lockHeld = true;
      },
      releaseLock() {
        lockCalls.releases += 1;
        lockHeld = false;
      },
    }),
  };

  const Logger = { log: (message) => { logs.push(String(message)); } };

  return {
    globals: { Utilities, PropertiesService, SpreadsheetApp, ContentService, LockService, Logger },
    logs,
    lockCalls,
    properties,
    spreadsheets,
  };
}
