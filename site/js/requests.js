// Requests to correct the closed data of the journal: the texts of values, the lines of a request, the states. Pure, no DOM, for tests.
// The rules of core/requests.js are copied here (the site cannot load core/); tests/siteRequests.test.js compares them.

const STATUSES = ['present', 'late', 'absent', 'excused', 'madeup'];
const STATUS_VIEWS = {
  dean: 'warning', prorector: 'warning', applied: 'success', rejected: 'danger', stale: 'danger', withdrawn: 'neutral',
};
const PROBLEM_CODES = ['bad_value', 'same', 'changed', 'required', 'too_long', 'not_allowed', 'self_by_work', 'bad_ref', 'no_attempt'];

// A mark as the server writes it in a request: 'status|noCoat|activity'; no mark is ''.
export function markToText(mark) {
  if (mark === null || mark === undefined) return '';
  const activity = mark.activity === null || mark.activity === undefined ? '' : String(mark.activity);
  return `${mark.status}|${mark.noCoat ? 1 : 0}|${activity}`;
}

// The other way; null for no mark, undefined for a text that is none.
export function textToMark(text) {
  if (typeof text !== 'string') return undefined;
  if (text === '') return null;
  const parts = text.split('|');
  if (parts.length !== 3) return undefined;
  const [status, coat, activity] = parts;
  if (!STATUSES.includes(status)) return undefined;
  if (coat !== '0' && coat !== '1') return undefined;
  if (activity !== '' && !/^\d{1,3}$/.test(activity)) return undefined;
  return { status, noCoat: coat === '1', activity: activity === '' ? null : Number(activity) };
}

// Points typed in a field as the server compares them: digits without leading zeros; '' stays; anything else null.
export function normalizePoints(text) {
  const clean = String(text ?? '').trim();
  if (clean === '') return '';
  return /^\d{1,3}$/.test(clean) ? String(Number(clean)) : null;
}

// A value of a request for the screen: { key, params, keyParams } (the params named in keyParams are keys, to be translated).
export function valueLine(kind, text) {
  const none = { key: kind === 'current' ? 'request.value.auto' : 'request.value.none', params: {}, keyParams: [] };
  if (typeof text !== 'string' || text === '') return none;
  if (kind === 'mark') {
    const mark = textToMark(text);
    if (!mark) return none;
    return { key: 'request.value.mark', params: { status: 'journal.marks.status.' + mark.status, activity: mark.activity, coat: mark.noCoat }, keyParams: ['status'] };
  }
  if (kind === 'exam' && (text === 'absent' || text === 'incomplete')) return { key: 'ledger.exam.' + text, params: {}, keyParams: [] };
  return { key: 'request.value.number', params: { value: text }, keyParams: [] };
}

const dayOf = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '');

// What a request changes: { key, params }.
export function targetLine(request) {
  switch (request.kind) {
    case 'mark': return { key: 'request.target.mark', params: { date: dayOf(request.pairDate), slot: request.pairSlot } };
    case 'work': return { key: 'request.target.work', params: { title: request.assignmentTitle } };
    case 'exam': return { key: 'request.target.exam', params: { no: request.attemptNo } };
    default: return { key: 'request.target.' + request.kind, params: { unit: request.unit } };
  }
}

export function statusView(status) {
  return { key: 'request.status.' + status, tone: STATUS_VIEWS[status] ?? 'neutral' };
}

// The fields of a refused filing [{ field, code }] -> Map(field -> key of the text of the form).
export function requestProblems(fields) {
  const map = new Map();
  for (const item of Array.isArray(fields) ? fields : []) {
    if (item && typeof item.field === 'string' && !map.has(item.field)) map.set(item.field, 'request.form.error.' + (PROBLEM_CODES.includes(item.code) ? item.code : 'bad_value'));
  }
  return map;
}

// The two changes a teacher makes himself after the term (the same as limitedAllowed of the server).
function smallChange(old, next) {
  if (!old || !next || old.noCoat !== next.noCoat) return false;
  if (old.status === 'absent' && next.status === 'excused') return true;
  return (old.status === 'absent' || old.status === 'excused') && next.status === 'madeup';
}

// Does the change of a mark need a request: the pair is held and its unit is closed, or the term is over and the change is none of the two small ones.
export function markRequestNeeded(pair, journal, mark, next) {
  if (!pair || pair.status !== 'closed') return false;
  const units = journal && journal.closed && Array.isArray(journal.closed.units) ? journal.closed.units : [];
  if (pair.unit !== null && pair.unit !== undefined && units.includes(pair.unit)) return true;
  return pair.state === 'late' && !smallChange(mark, next);
}

const OPEN = ['dean', 'prorector'];

// The queue of the deanery and the vice-rector as three parts, each in the order of the answer: the open ones this person decides
// (the server's can.decide), the other open ones, the closed ones. The buttons follow the flag of the server and nothing else.
export function queueParts(requests) {
  const parts = { mine: [], waiting: [], closed: [] };
  for (const request of Array.isArray(requests) ? requests : []) {
    if (!OPEN.includes(request.status)) parts.closed.push(request);
    else if (request.can && request.can.decide === true) parts.mine.push(request);
    else parts.waiting.push(request);
  }
  return parts;
}

// Whose decision an open request waits for: { key }; null for a closed one.
export function stepText(request) {
  return request && OPEN.includes(request.status) ? { key: 'request.step.' + request.status } : null;
}
