import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, emptyState, focusById, note, pageHeader, refresh } from '../ui.js';
import { journalColumns, cellView, pairHead, canMark, pairHint } from '../journal.js';
import { openMarksDialog } from './journalPair.js';
import { openCellDialog } from './journalCell.js';
import { icon } from '../icons.js';
import { getUser } from '../session.js';
import { activeRole } from '../shell.js';

// The journal of a subject (#/journal/<subjectId>): the grid of students and pairs, read only (journal.get).
// Rows are students (those who left stand last, dimmed); columns are pairs, and after the last pair of a unit
// its four columns (current control, self-work, unit control, total), then the summary of attendance.
// The head of a pair the person may fill in (mode `free` or `reason`) looks like a button and opens the window of its
// marks; a cell of a held pair opens the window of that student's mark (late correction and the history). The server decides what is
// in the answer (a teacher who only substituted gets just their pairs, no unit totals); the screen only draws it.

const blank = (subjectId = null) => ({
  subjectId,
  data: null,          // the answer of journal.get; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.subjectId !== params.subjectId) state = blank(params.subjectId);
  if (state.data === null && !state.loading && state.errorCode === null) load();
  const subject = state.data && state.data.journal.subject;
  root.append(
    pageHeader({
      id: 'journal-title',
      title: subject ? `${subject.name} · ${subject.groupName}` : t('journal.title'),
      lead: subject && subject.teacherName ? t('journal.teacherLine', { name: subject.teacherName }) : null,
    }),
    state.data === null ? loadingBody() : body(state.data.journal));
}

// An answer that comes after the person left the page (or opened another journal) draws nothing.
async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('journal.get', { subjectId: owner.subjectId });
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, errorCode: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code || 'internal';
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retry() {
  state.errorCode = null;
  load();
  refresh();
}

function loadingBody() {
  const code = state.errorCode;
  if (code === null) return el('p', { class: 'loading' }, t('journal.loading'));
  const back = el('a', { class: 'button button--secondary', href: '#/journal' }, t('journal.back'));
  const key = code === 'not_found' ? 'journal.notFound' : errorKey(code);
  const failure = emptyState('alert', el('p', {}, t(key)),
    code === 'not_found' || code === 'forbidden' ? back
      : el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

const dayMonth = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const pointText = (value) => (value === null || value === undefined ? '—' : String(value));

function body(journal) {
  const notes = [];
  if (journal.partial) notes.push(note('info', t('journal.partial'), { id: 'journal-partial' }));
  else if (!journal.subject.hasSyllabus) notes.push(note('warning', t('journal.noSyllabus'), { id: 'journal-no-syllabus' }));
  if (journal.pairs.length === 0) {
    return el('div', { class: 'journal' }, notes, emptyState('table', el('p', { class: 'empty__title' }, t('journal.emptyPairs'))));
  }
  return el('div', { class: 'journal' },
    notes,
    el('p', { class: 'journal__scheme', id: 'journal-scheme' }, t('journal.scheme', { attendance: journal.scheme.attendance, activity: journal.scheme.activity })),
    legend(journal.pairs.some(canMark)),
    journal.students.length === 0
      ? emptyState('table', el('p', { class: 'empty__title' }, t('journal.emptyStudents')))
      : grid(journal));
}

// The key to the marks of the grid.
function legend(withOpen) {
  const item = (text, ...marks) => el('li', { class: 'journal-legend__item' }, marks, el('span', {}, text));
  const chip = (status) => el('span', { class: `jg-mark jg-mark--${cellView({ status }).tone}`, 'aria-hidden': 'true' }, t(cellView({ status }).key));
  return el('ul', { class: 'journal-legend', 'aria-label': t('journal.legend.title') },
    ['present', 'late', 'absent', 'excused', 'madeup'].map((status) => item(t('journal.legend.' + status), chip(status))),
    ['unfilled', 'overdue', 'missed'].map((name) => item(t('journal.state.' + name), el('span', { class: `jg-state jg-state--${name}`, 'aria-hidden': 'true' }))),
    item(t('journal.legend.noCoat'), el('span', { class: 'jg-coat', 'aria-hidden': 'true' })),
    item(t('journal.legend.activity'), el('span', { class: 'jg-act', 'aria-hidden': 'true' }, '5')),
    item(t('journal.legend.manual'), el('span', { class: 'jg-star', 'aria-hidden': 'true' }, '*')),
    withOpen ? item(t('journal.legend.open'), el('span', { class: 'jg-open-sample', 'aria-hidden': 'true' }, icon('pencil'))) : null);
}

function grid(journal) {
  const columns = journalColumns(journal);
  const { scheme } = journal;
  return el('section', { class: 'card journal-card', 'aria-labelledby': 'journal-title' },
    el('div', { class: 'table-scroll journal-scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'journal-title' },
      el('table', { class: 'journal-grid', id: 'journal-grid' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', class: 'jg-name' }, t('journal.col.student')),
          columns.map((column) => head(column, journal)))),
        el('tbody', {}, journal.students.map((student, index) => studentRow(student, index + 1, columns, journal, scheme))))));
}

// A tooltip that opens on hover and on keyboard focus of the head; the head is focusable for that.
function tip(text) {
  return el('span', { class: 'jg-tip', role: 'tooltip' }, text);
}

function head(column, journal) {
  if (column.type === 'pair') return pairHeadCell(column.pair);
  if (column.type === 'unit') {
    const label = t('journal.col.' + column.field);
    const unit = journal.units.find((u) => u.unit === column.unit);
    const max = { current: journal.scheme.current, self: journal.scheme.self, control: journal.scheme.control, total: 100 }[column.field];
    return el('th', { scope: 'col', class: `jg-unit-head jg-unit-head--${column.field}`, tabindex: '0' },
      el('span', { class: 'jg-unit-head__unit' }, t('journal.col.unit', { n: column.unit })),
      el('span', { class: 'jg-unit-head__label' }, label),
      tip([unit && unit.title ? unit.title + '. ' : '', t('journal.tip.' + column.field, { max })].join('')));
  }
  const key = column.type === 'outside' ? 'journal.col.outside' : 'journal.col.' + column.field;
  const tipKey = column.type === 'outside' ? null : 'journal.tip.' + column.field;
  return el('th', { scope: 'col', class: `jg-sum-head jg-sum-head--${column.type === 'outside' ? 'outside' : column.field}`, tabindex: tipKey ? '0' : null },
    el('span', { class: 'jg-unit-head__label' }, t(key)),
    tipKey ? tip(t(tipKey)) : null);
}

function pairHeadCell(pair) {
  const { kindKey, stateKey } = pairHead(pair);
  const narrow = pair.status === 'cancelled' || pair.status === 'missed';
  const topic = pair.topicName ? t('journal.topic', { n: pair.number === '' ? '' : pair.number, name: pair.topicName }) : t('journal.topicNone');
  const hint = pairHint(pair, activeRole(getUser()));
  const tipText = [topic, stateKey ? t(stateKey) : null, pair.substitution ? t('journal.sub', { name: pair.teacherName }) : null, hint ? t(hint) : null].filter(Boolean).join(' · ');
  const open = canMark(pair);
  return el('th', { scope: 'col', class: `jg-pair-head${narrow ? ' is-narrow' : ''}${pair.status === 'planned' ? ' is-planned' : ''}${open ? ' is-open' : ''}`, tabindex: open ? null : '0', 'data-pair': pair.id },
    open ? el('button', {
      type: 'button', class: 'jg-open', id: openId(pair), 'aria-haspopup': 'dialog',
      'aria-label': t('journal.marks.open', { date: dayMonth(pair.date), kind: t(kindKey) }), onclick: () => openMarks(pair),
    }) : null,
    el('span', { class: 'jg-pair-head__date' }, dayMonth(pair.date)),
    el('span', { class: `jg-pair-head__kind jg-kind--${pair.lessonType || 'none'}` }, t(kindKey)),
    stateKey ? el('span', { class: `jg-state jg-state--${stateKey.slice('journal.state.'.length)}`, 'aria-hidden': 'true' }) : null,
    pair.substitution ? el('span', { class: 'jg-pair-head__sub' }, surname(pair.teacherName)) : null,
    open ? el('span', { class: 'jg-pair-head__act', 'aria-hidden': 'true' }, icon('pencil'),
      pair.status === 'planned' ? el('span', { class: 'jg-pair-head__act-text' }, t('journal.markAction')) : null) : null,
    tip(tipText));
}

const openId = (pair) => `journal-open-${pair.id}`;

// The window of the marks of a pair; the grid is drawn again from the answer to the save.
function openMarks(pair) {
  const owner = state;
  openMarksDialog({
    journal: owner.data.journal,
    pair,
    onSaved: (data) => {
      if (state !== owner) return;
      owner.data = data;
      refresh();
    },
    onClosed: () => focusById(openId(pair)),
  });
}

const surname = (fullName) => String(fullName || '').trim().split(/\s+/)[0] || '—';

function studentRow(student, number, columns, journal, scheme) {
  const result = journal.results[student.id] || null;
  return el('tr', { class: student.left ? 'is-left' : null, 'data-student': student.id },
    el('th', { scope: 'row', class: 'jg-name' },
      el('span', { class: 'jg-name__no' }, String(number)),
      el('span', { class: 'jg-name__text' }, student.fullName || '—'),
      student.left ? el('span', { class: 'jg-name__left' }, t('journal.left')) : null),
    columns.map((column) => cell(column, student, result, journal, scheme)));
}

function cell(column, student, result, journal, scheme) {
  if (column.type === 'pair') return markCell(column.pair, (journal.marks[column.pair.id] || {})[student.id], student);
  if (!result) return el('td', { class: 'jg-empty' }, '—');
  if (column.type === 'unit') {
    const row = result.units.find((u) => u.unit === column.unit);
    return row ? unitCell(column.field, row, scheme) : el('td', { class: 'jg-empty' }, '—');
  }
  if (column.type === 'outside') return el('td', { class: 'jg-num jg-outside', title: t('journal.tip.outside', result.outside) }, pointText(result.outside.possible > 0 ? result.outside.earned : null));
  const { attendance } = result;
  if (column.field === 'absences') return el('td', { class: 'jg-num jg-sum jg-sum--absences' }, String(attendance.absent + attendance.excused));
  if (column.field === 'percent') return el('td', { class: 'jg-num jg-sum' }, attendance.percent === null ? '—' : attendance.percent + '%');
  return el('td', { class: 'jg-num jg-sum jg-sum--final', title: result.word ? t('journal.grade.' + result.word) : null }, pointText(result.preliminary));
}

function unitCell(field, row, scheme) {
  if (field === 'current') {
    const manual = row.manual !== null;
    return el('td', { class: `jg-num jg-pts${row.currentLow ? ' is-low' : ''}`, title: [t('journal.tip.current', { max: scheme.current }), manual ? t('journal.tip.manual') : null].filter(Boolean).join(', ') },
      pointText(row.current), manual ? el('span', { class: 'jg-star' }, '*') : null);
  }
  if (field === 'self') return el('td', { class: 'jg-num jg-pts', title: t('journal.tip.self', { max: scheme.self }) }, pointText(row.self));
  if (field === 'control') return el('td', { class: `jg-num jg-pts${row.controlLow ? ' is-low' : ''}`, title: t('journal.tip.control', { max: scheme.control }) }, pointText(row.control));
  const word = row.word ? ', ' + t('journal.grade.' + row.word) : '';
  return el('td', { class: `jg-num jg-pts jg-total${row.word === 'fail' ? ' is-low' : ''}`, title: t('journal.tip.total', { max: 100 }) + word }, pointText(row.total));
}

const cellId = (pair, student) => `journal-cell-${pair.id}-${student.id}`;

// The window of the mark of a student on a held pair; the grid is drawn again from the answer to a save.
function openCell(pair, student) {
  const owner = state;
  openCellDialog({
    journal: owner.data.journal,
    pair,
    student,
    onSaved: (data) => {
      if (state !== owner) return;
      owner.data = data;
      refresh();
    },
    onClosed: () => focusById(cellId(pair, student)),
  });
}

function markCell(pair, mark, student) {
  const view = cellView(mark, pair);
  const narrow = pair.status === 'cancelled' || pair.status === 'missed';
  const openable = pair.status === 'running' || pair.status === 'closed';
  const className = `jg-cell${narrow ? ' is-narrow' : ''}${openable ? ' is-open' : ''}`;
  const text = view === null ? '' : [t('journal.legend.' + mark.status), view.noCoat ? t('journal.legend.noCoat') : null, view.activity !== null ? t('journal.tip.activity', { n: view.activity }) : null].filter(Boolean).join(', ');
  const opener = openable ? el('button', {
    type: 'button', class: 'jg-cell-open', id: cellId(pair, student), 'aria-haspopup': 'dialog',
    'aria-label': `${t('journal.cell.open', { name: student.fullName || '—', date: dayMonth(pair.date) })}. ${text || t('journal.cell.noMark')}`,
    onclick: () => openCell(pair, student),
  }) : null;
  if (view === null) return el('td', { class: className }, opener);
  return el('td', { class: className, title: text, 'aria-label': openable ? null : text },
    opener,
    el('span', { class: 'jg-cell__in' },
      el('span', { class: `jg-mark jg-mark--${view.tone}` }, t(view.key)),
      view.activity !== null ? el('span', { class: 'jg-act' }, String(view.activity)) : null,
      view.noCoat ? el('span', { class: 'jg-coat' }) : null));
}
