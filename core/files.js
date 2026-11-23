// Rules of an uploaded file: its clean name, its kind by name and by content.
export const FILE_LIMITS = Object.freeze({
  maxBytes: 10485760,
  perWork: 5,
  perDayCount: 60,
  perDayBytes: 209715200,
  nameMax: 120,
  keepPendingMs: 86400000,
});

export const FILE_KINDS = ['jpg', 'png', 'pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'];

const BAD_CHARS = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export function cleanFileName(raw) {
  if (typeof raw !== 'string') return 'file';
  const parts = raw.split(/[\\/]/);
  let name = parts[parts.length - 1].replace(BAD_CHARS, '').trim();
  if (!name || name === '.' || name === '..') return 'file';
  const chars = Array.from(name);
  if (chars.length > FILE_LIMITS.nameMax) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? Array.from(name.slice(dot)) : [];
    if (ext.length > 0 && ext.length < FILE_LIMITS.nameMax) {
      const base = Array.from(name.slice(0, dot)).slice(0, FILE_LIMITS.nameMax - ext.length);
      name = base.join('') + ext.join('');
    } else {
      name = chars.slice(0, FILE_LIMITS.nameMax).join('');
    }
  }
  return name || 'file';
}

const KIND_BY_EXT = {
  jpg: 'jpg', jpeg: 'jpg', png: 'png', pdf: 'pdf',
  docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', doc: 'doc', xls: 'xls', ppt: 'ppt',
};

export function kindByName(name) {
  if (typeof name !== 'string') return null;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(KIND_BY_EXT, ext) ? KIND_BY_EXT[ext] : null;
}

export function base64Bytes(text) {
  if (typeof text !== 'string') return null;
  if (text.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - pad;
}

function startsWith(bytes, sig) {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

function ascii(text) {
  return Array.from(text, (c) => c.charCodeAt(0));
}

function utf16le(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 255, text.charCodeAt(i) >> 8);
  return out;
}

// Substring search over bytes (no string conversion of the whole file).
function hasBytes(bytes, needle) {
  const first = needle[0];
  const last = bytes.length - needle.length;
  let i = bytes.indexOf(first);
  while (i !== -1 && i <= last) {
    let j = 1;
    while (j < needle.length && bytes[i + j] === needle[j]) j++;
    if (j === needle.length) return true;
    i = bytes.indexOf(first, i + 1);
  }
  return false;
}

const SIG = {
  jpg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  pdf: ascii('%PDF-'),
  zip: [0x50, 0x4b, 0x03, 0x04],
  ole: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};
const OOXML_PART = { docx: ascii('word/document.xml'), xlsx: ascii('xl/workbook.xml'), pptx: ascii('ppt/presentation.xml') };
const ZIP_MACROS = [ascii('vbaProject.bin'), ascii('macrosheets/')];
const OLE_MACRO = utf16le('_VBA_PROJECT');

export function sniffKind(bytes, kind) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;
    if (kind === 'jpg' || kind === 'png' || kind === 'pdf') return startsWith(bytes, SIG[kind]) ? kind : null;
    if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
      if (!startsWith(bytes, SIG.zip)) return null;
      if (!hasBytes(bytes, OOXML_PART[kind])) return null;
      if (ZIP_MACROS.some((m) => hasBytes(bytes, m))) return null;
      return kind;
    }
    if (kind === 'doc' || kind === 'xls' || kind === 'ppt') {
      if (!startsWith(bytes, SIG.ole)) return null;
      if (hasBytes(bytes, OLE_MACRO)) return null;
      return kind;
    }
    return null;
  } catch {
    return null;
  }
}

export function isStoredName(name) {
  return typeof name === 'string' && /^[0-9a-f]{32}\.bin$/.test(name);
}
