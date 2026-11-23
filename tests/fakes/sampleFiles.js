// Small synthetic file samples for the uploaded-file rules. Not real files.

// Uint8Array from numbers and strings (strings byte by byte, latin1).
export function bytesOf(...parts) {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p & 255);
    else if (typeof p !== 'string') for (const n of p) out.push(n & 255);
    else for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i) & 255);
  }
  return Uint8Array.from(out);
}

// UTF-16LE bytes of a text.
export function utf16(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out.push(c & 255, c >> 8);
  }
  return Uint8Array.from(out);
}

function zipLike(...names) {
  const parts = [0x50, 0x4b, 0x03, 0x04, '\u0014\u0000\u0000\u0000\u0008\u0000'];
  for (const n of names) parts.push('\u0000\u0000\u0000\u0000' + n + '\u0000' + 'x'.repeat(40));
  return bytesOf(...parts);
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const pad = (n) => '\u0000'.repeat(n);

export const SAMPLE = {
  jpg: bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'JFIF', pad(60)),
  png: bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, pad(8), 'IHDR', pad(60)),
  pdf: bytesOf('%PDF-1.7\n', '1 0 obj\n<< /Type /Catalog >>\nendobj\n', '%%EOF\n'),
  docx: zipLike('[Content_Types].xml', 'word/document.xml'),
  xlsx: zipLike('[Content_Types].xml', 'xl/workbook.xml'),
  pptx: zipLike('[Content_Types].xml', 'ppt/presentation.xml'),
  doc: bytesOf(...OLE, pad(120), 'WordDocument', pad(60)),
};

export const FAKE = {
  exe: bytesOf('MZ', 0x90, 0x00, 0x03, pad(60), 'This program cannot be run in DOS mode.'),
  svg: bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  html: bytesOf('<!doctype html><html><body><script>alert(1)</script></body></html>'),
  zip: zipLike('readme.txt', 'data/other.bin'),
  docm: zipLike('[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'),
  docMacro: bytesOf(...OLE, pad(120), 'WordDocument', pad(20), utf16('_VBA_PROJECT'), pad(20)),
};

// base64 of bytes (Buffer is allowed in tests only).
export function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}
