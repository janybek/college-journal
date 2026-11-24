import fs from 'node:fs';
import path from 'node:path';
import { FILES_DIR } from './files.js';

// Settings of the working server. Node only: this file is not bundled for Apps Script.
// One source, never mixed: the JOURNAL_* variables when JOURNAL_DATA_DIR is set, otherwise the settings file.

export const DEFAULTS = { port: 5373, origins: ['https://janybek.github.io'] };
export const LOCAL_CONFIG = 'serve.local.json';
export const START_ALERT_FILE = 'Журнал — не запустился.txt';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const STAND_PORTS = [5173, 5273];
const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const ORIGIN_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/;

export class ConfigError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'ConfigError';
    this.code = code;
  }
}

function readFileSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new ConfigError('bad_config', 'cannot read the settings file');
  }
  let value;
  try {
    value = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new ConfigError('bad_config', 'the settings file is not JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ConfigError('bad_config', 'the settings file is not an object');
  return value;
}

function readEnvSettings(env) {
  const settings = {
    dataDir: env.JOURNAL_DATA_DIR, backupDir: env.JOURNAL_BACKUP_DIR, alertDir: env.JOURNAL_ALERT_DIR,
    host: env.JOURNAL_HOST ?? '0.0.0.0', siteDir: env.JOURNAL_SITE_DIR, autoInit: env.JOURNAL_AUTO_INIT === '1',
  };
  if (env.JOURNAL_PORT !== undefined) settings.port = /^[0-9]+$/.test(env.JOURNAL_PORT) ? Number(env.JOURNAL_PORT) : env.JOURNAL_PORT;
  if (env.JOURNAL_ORIGINS !== undefined) settings.origins = env.JOURNAL_ORIGINS.split(',').map((s) => s.trim());
  return settings;
}

// The existing part of the path is resolved through the file system (links, 8.3 names), the rest is kept as written.
function realPath(target) {
  const rest = [];
  let current = target;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest.reverse());
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current) return target;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function isInside(root, folder) {
  const relative = path.relative(realPath(root).toLowerCase(), realPath(folder).toLowerCase());
  return relative === '' || (!(relative === '..' || relative.startsWith('..' + path.sep)) && !path.isAbsolute(relative));
}

function folderOf(value, root, name, required) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ConfigError(name === 'dataDir' ? 'no_data_dir' : 'no_backup_dir', name + ' is not set');
    return '';
  }
  if (typeof value !== 'string') throw new ConfigError('bad_config', name + ' is not text');
  const folder = path.resolve(root, value);
  if (isInside(root, folder)) throw new ConfigError('inside_repo', name + ' is inside the repository');
  return folder;
}

function siteFolderOf(value, root) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new ConfigError('bad_config', 'siteDir is not text');
  const folder = path.resolve(root, value);
  let isFolder = false;
  try {
    isFolder = fs.statSync(folder).isDirectory();
  } catch (error) { /* not there */ }
  if (!isFolder) throw new ConfigError('bad_site_dir', 'the site folder does not exist');
  return folder;
}

export function readConfig({ env = process.env, root = REPO_ROOT, file } = {}) {
  const inEnv = Boolean(env.JOURNAL_DATA_DIR);
  const settings = inEnv ? readEnvSettings(env) : readFileSettings(file || path.join(root, LOCAL_CONFIG));
  const dataDir = folderOf(settings.dataDir, root, 'dataDir', true);
  const backupDir = folderOf(settings.backupDir, root, 'backupDir', true);
  const alertDir = folderOf(settings.alertDir, root, 'alertDir', false);

  const port = settings.port === undefined ? DEFAULTS.port : settings.port;
  if (!Number.isInteger(port) || !(port === 0 || (port >= 1024 && port <= 65535)) || STAND_PORTS.includes(port)) throw new ConfigError('bad_port', 'bad port');

  const origins = settings.origins === undefined ? [...DEFAULTS.origins] : settings.origins;
  if (!Array.isArray(origins) || origins.length === 0 || !origins.every((o) => typeof o === 'string' && ORIGIN_PATTERN.test(o))) throw new ConfigError('bad_origin', 'bad origins');

  const host = settings.host ?? '127.0.0.1';
  if (typeof host !== 'string' || !(IPV4.test(host) || host === '::' || host === '::1')) throw new ConfigError('bad_host', 'bad host');
  const siteDir = siteFolderOf(settings.siteDir, root);
  // the site folder is public: it may not be, hold or lie inside the data, the copies or the alerts
  for (const other of [dataDir, backupDir, alertDir]) {
    if (siteDir !== '' && other !== '' && (isInside(siteDir, other) || isInside(other, siteDir))) throw new ConfigError('bad_site_dir', 'the site folder touches a folder of the data');
  }

  return {
    dataDir, backupDir, alertDir, port, origins, host, siteDir,
    autoInit: inEnv && settings.autoInit === true,
    filesDir: path.join(dataDir, FILES_DIR),
    dbFile: path.join(dataDir, 'journal.sqlite'),
    secretFile: path.join(dataDir, 'secret.key'),
    logFile: path.join(dataDir, 'server.log'),
    stateFile: path.join(dataDir, 'server.state.json'),
    stopFile: path.join(dataDir, 'stop.request'),
    supervisorFile: path.join(dataDir, 'supervisor.state.json'),
  };
}
