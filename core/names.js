// Alphabet order of the college: Russian letters plus the Kyrgyz ones (ё after е, ң after н, ө after о, ү after у).
const ALPHABET = 'абвгдеёжзийклмнңоөпрстуүфхцчшщъыьэюя';

// Position of a character: signs outside the alphabet come first (by code), then the letters.
function rank(ch) {
  const i = ALPHABET.indexOf(ch);
  return i === -1 ? ch.codePointAt(0) : 100000 + i;
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function compareNames(a, b) {
  const x = String(a == null ? '' : a).trim();
  const y = String(b == null ? '' : b).trim();
  const lx = Array.from(x.toLowerCase());
  const ly = Array.from(y.toLowerCase());
  const n = Math.min(lx.length, ly.length);
  for (let i = 0; i < n; i += 1) {
    const d = rank(lx[i]) - rank(ly[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (lx.length !== ly.length) return lx.length < ly.length ? -1 : 1;
  return byCode(x, y);
}
