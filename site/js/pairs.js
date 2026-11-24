import { addDays, weekday } from './dates.js';

// Pairs of the schedule screens (PairView from the server), without the DOM.

// [{ date, pairs }] for `days` days in a row from `from`; inside a day the pairs go by their number.
export function groupByDay(pairs, from, days = 7) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, pairs: pairs.filter((pair) => pair.date === date).sort((a, b) => a.slot - b.slot) };
  });
}

// The week template of the group opened on the weekday of `date` (#/template/<groupId>/<1–5>); the template has
// no weekend, so Saturday and Sunday (and a missing group) have no address.
export function templateHref(groupId, date) {
  const day = weekday(date);
  return groupId && day <= 5 ? '#/template/' + groupId + '/' + day : null;
}

// ---- The week as a grid: the pair numbers of the week are its rows, its days the columns ----

const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// [{ slot, startTime, endTime }] by pair number, only the numbers the week has. A row takes the time of the earliest
// pair of its number (by date, then id): the bells may have changed in the middle of the week.
export function weekRows(pairs) {
  const first = new Map();
  for (const pair of [...pairs].sort(byDateThenId)) if (!first.has(pair.slot)) first.set(pair.slot, pair);
  return [...first.values()].sort((a, b) => a.slot - b.slot).map(({ slot, startTime, endTime }) => ({ slot, startTime, endTime }));
}

// The dates of the columns: Monday to Friday always, Saturday and Sunday only when there is a pair on that day.
export function gridDays(pairs, from) {
  return Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((date, i) => i < 5 || pairs.some((pair) => pair.date === date));
}

// The pairs of one cell in the order given, the cancelled ones after the others.
export function cellPairs(pairs, date, slot) {
  const here = pairs.filter((pair) => pair.date === date && pair.slot === slot);
  return [...here.filter((pair) => pair.status !== 'cancelled'), ...here.filter((pair) => pair.status === 'cancelled')];
}

// The pair does not keep the time of its row (the bells changed in the middle of the week): its card says when.
export function ownTime(pair, row) {
  return pair.startTime !== row.startTime || pair.endTime !== row.endTime;
}

// What is special about a pair, always in this order: cancelled, substitution, moved.
export function pairFlags(pair) {
  const flags = [];
  if (pair.status === 'cancelled') flags.push('cancelled');
  if (pair.substitution) flags.push('substitution');
  if (pair.moved) flags.push('moved');
  return flags;
}

// The pair may still be changed: the condition of pairLock(pair, today) === null in core/schedule.js. Only site/
// is published and the site cannot load core/, so this is a copy; tests/pairs.test.js checks that both agree.
export function canEditPair(pair, today) {
  return pair.status === 'planned' && pair.date >= today;
}

// A cancelled pair of today or later can be put back.
export function canRestorePair(pair, today) {
  return pair.status === 'cancelled' && pair.date >= today;
}

// What the pair dialog changes: only the fields that differ from the pair as it is (values are the dialog's
// strings: slot as text, no room as ''), the note trimmed. Nothing changed: {}.
export function pairPatch(values, pair) {
  const patch = {};
  if (values.teacherId !== pair.teacherId) patch.teacherId = values.teacherId;
  if (values.date !== pair.date) patch.date = values.date;
  if (Number(values.slot) !== pair.slot) patch.slot = Number(values.slot);
  if (values.roomId !== (pair.roomId ?? '')) patch.roomId = values.roomId;
  if (values.note.trim() !== (pair.note ?? '')) patch.note = values.note.trim();
  return patch;
}

// ---- The lesson on a pair: `topic` of a pair view, a lesson of a syllabus row (no DOM) ----

// What to write about the lesson, for t(): «Л1. name», or «Модуль N (рубежный контроль)» for a module without a
// name, a named module by its name alone. label: the letter of the kind (a key of the dictionary) and the number of
// the journal; the screen writes them together («Л» + 1) as the {label} of 'pairs.topicLabel'.
export function topicText(topic) {
  if (topic.lessonKind === 'control') {
    return topic.name ? { key: 'pairs.topicPlain', params: { name: topic.name } } : { key: 'syllabus.controlN', params: { n: topic.unit } };
  }
  if (typeof topic.number !== 'number') return { key: 'pairs.topicPlain', params: { name: topic.name } };
  return { key: 'pairs.topicLabel', params: { name: topic.name }, label: { key: 'lessonType.short.' + topic.lessonKind, number: topic.number } };
}

// The name of the type of the lesson: its kind (lecture, practice, seminar, laboratory, module).
export function lessonTypeKey(topic) {
  return 'lessonType.' + topic.lessonKind;
}

// «Практика 1 из 2»: only when the row has more than one pair of this type.
export function lessonParts(topic) {
  return topic.parts > 1 ? { part: topic.part, parts: topic.parts } : null;
}

// The modules (рубежный контроль) without hours marked on a lesson (`controls` of a pair view): the names of those
// that have one, for t(), and whether the «Модуль» badge stands for those that have none. A named mark goes without
// the badge, since its name is what the syllabus calls it («Модуль 1 (рубежный контроль)» next to «Модуль» said the
// same twice); a mark without a name is the badge alone. Anything but an array: no marks.
export function controlLine(controls) {
  const marks = Array.isArray(controls) ? controls.filter((mark) => mark !== null && typeof mark === 'object') : [];
  const named = marks.filter((mark) => typeof mark.name === 'string' && mark.name !== '');
  return {
    badge: named.length < marks.length,
    names: named.map((mark) => ({ key: 'pairs.topicPlain', params: { name: mark.name } })),
  };
}

// ---- Long names in a narrow card ----

// Syllable rules of Russian (Kyrgyz and English follow them well enough): a break after й/ь/ъ, between two vowels,
// and between consonants that stand between vowels. Each rule: [what stays before the break, what must follow it].
const VOWELS = 'аеёиоуыэюяөүaeiouy';
const CONSONANTS = 'бвгджзклмнпрстфхцчшщңbcdfghjklmnpqrstvwxz';
const SIGNS = 'йьъ';
const ANY = '[' + VOWELS + CONSONANTS + SIGNS + ']';
const VOWEL = '[' + VOWELS + ']';
const CONSONANT = '[' + CONSONANTS + ']';
const SYLLABLE_RULES = [
  ['[' + SIGNS + ']', ANY + ANY],
  [VOWEL, VOWEL + ANY],
  [VOWEL + CONSONANT, CONSONANT + VOWEL],
  [CONSONANT + VOWEL, CONSONANT + VOWEL],
  [VOWEL + CONSONANT, CONSONANT + CONSONANT + VOWEL],
  [VOWEL + CONSONANT + CONSONANT, CONSONANT + CONSONANT + VOWEL],
].map(([before, after]) => new RegExp('(' + before + ')(?=' + after + ')', 'gi'));
const SOFT_HYPHEN = '\u00AD';
const LONG_WORD = 8;

function hyphenateWord(word) {
  if (word.length < LONG_WORD) return word;
  const allowed = new Set();
  for (const rule of SYLLABLE_RULES) for (const match of word.matchAll(rule)) allowed.add(match.index + match[1].length);
  const cuts = [];
  for (const at of [...allowed].sort((a, b) => a - b)) {
    if (at < 2 || word.length - at < 2 || (cuts.length > 0 && at - cuts[cuts.length - 1] < 2)) continue;
    cuts.push(at);
  }
  return cuts.reduceRight((text, at) => text.slice(0, at) + SOFT_HYPHEN + text.slice(at), word);
}

// The name with soft hyphens between the syllables of its long words: a card narrower than a word («Предпринимательство»
// in a column of 120 px) breaks it as «Предпринима-тельство» instead of at the edge. Shown as text only; the soft
// hyphens are invisible where the word fits.
export function hyphenate(text) {
  return String(text ?? '').replace(/[a-zа-яёөүң]+/gi, hyphenateWord);
}

// ---- The credit week: `exam` of schedule.list / schedule.mine ({ start, end }, '' when there is none) ----

// The date is a day of the credit week. A copy of inExam in core/settings.js: the site cannot load core/.
export function inExamWeek(date, exam) {
  return !!exam && typeof exam.start === 'string' && exam.start !== '' && date >= exam.start && date <= exam.end;
}

// The key of the label of a day of the credit week; null for any other day.
export function examDayLabel(date, exam) {
  return inExamWeek(date, exam) ? 'schedule.exam.day' : null;
}
