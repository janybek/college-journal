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

// What to write about the lesson, for t(): «№. name», the name alone, or «Модуль N (рубежный контроль)» for a
// module without a name.
export function topicText(topic) {
  if (topic.kind === 'control' && !topic.name) return { key: 'syllabus.controlN', params: { n: topic.unit } };
  return topic.label ? { key: 'pairs.topicLabel', params: { label: topic.label, name: topic.name } } : { key: 'pairs.topicPlain', params: { name: topic.name } };
}

// The name of the type of the lesson: a practice is called after its kind (seminar, laboratory) when it has one.
const PRACTICE_KINDS = ['seminar', 'lab'];
export function lessonTypeKey(topic) {
  if (topic.lessonType === 'practice' && PRACTICE_KINDS.includes(topic.practiceKind)) return 'lessonType.' + topic.practiceKind;
  return 'lessonType.' + topic.lessonType;
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
