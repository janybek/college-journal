import fs from 'node:fs';
import { TZ_OFFSET_MS } from '../../core/dates.js';

// Work log of the server. Node only: this file is not bundled for Apps Script.
// No request bodies, passwords, tokens or names get here: callers pass only what the log may keep.
export const MAX_LOG_BYTES = 5 * 1024 * 1024;

const stamp = (ms) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');

export function createLogger(logFile, { now, maxBytes = MAX_LOG_BYTES, echo = null } = {}) {
  function rotate() {
    try {
      if (fs.statSync(logFile).size > maxBytes) fs.renameSync(logFile, logFile + '.1');
    } catch (error) { /* no file yet, or it cannot be moved: writing goes on */ }
  }

  function write(level, text, err) {
    try {
      let line = `${stamp(now())} ${level} ${String(text).replace(/[\r\n]+/g, ' ')}`;
      if (err) {
        const detail = String(err.stack || err).split(/\r?\n/).map((l) => '  ' + l).join('\n');
        line += '\n' + detail;
      }
      rotate();
      fs.appendFileSync(logFile, line + '\n');
      if (echo) echo(line);
    } catch (error) { /* a broken log never breaks the server */ }
  }

  return {
    info: (text) => write('INFO', text),
    error: (text, err) => write('ERROR', text, err),
  };
}
