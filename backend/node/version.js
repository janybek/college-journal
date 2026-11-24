import path from 'node:path';
import { execFileSync } from 'node:child_process';

// The version of the running code: the short hash of its commit. Node only: this file is not bundled for Apps Script.
// JOURNAL_VERSION (set when the Docker image is built) wins; otherwise git is asked once. Anything that does not look
// like a hash (no git, an error, a timeout, junk in the variable) is skipped, and the answer is 'unknown'.

export const UNKNOWN_VERSION = 'unknown';
const HASH = /^[0-9a-f]{7,40}$/;
const GIT_TIMEOUT_MS = 2000;
const CODE_ROOT = path.resolve(import.meta.dirname, '..', '..');

const defaultRun = (command, args, options) => execFileSync(command, args, options);

export function readVersion({ env = process.env, root = CODE_ROOT, run = defaultRun } = {}) {
  const given = env.JOURNAL_VERSION;
  if (typeof given === 'string' && HASH.test(given)) return given;
  try {
    const out = run('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, timeout: GIT_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const text = typeof out === 'string' ? out.trim() : '';
    return HASH.test(text) ? text : UNKNOWN_VERSION;
  } catch (error) {
    return UNKNOWN_VERSION;
  }
}
