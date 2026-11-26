import { t } from '../i18n.js';
import { el, iconButton } from '../ui.js';
import { icon } from '../icons.js';
import { listAdd, listMove, listRemove } from '../syllabusForm.js';

// The pieces of the syllabus form (syllabusForm.js draws the frame, syllabusFormTabs.js the tabs): a field bound to
// the form's state, the editor of a list of points and the table of the lessons of one kind in a unit.
// Every piece gets `ctx` of the frame:
//   ctx.doc, ctx.form            the document being edited, the answer of syllabus.form
//   ctx.readOnly                 the version is not edited: fields are off, no buttons to add, move or remove
//   ctx.error(key)               the code of the server's error at this field, or null (the field is marked as shown)
//   ctx.peek(key)                the same, without marking the field as shown
//   ctx.errorText(key, code)     the text of that error
//   ctx.typed(key, errorId, el)  after typing: the error mark of the field goes, the marks of unsaved tabs are updated
//   ctx.change(fn, focusId, edit) a change of the structure: fn() changes the state, the screen is redrawn, focus goes to focusId;
//                                edit 'remove' or 'move' takes the error marks off the tab (their places are other rows now)
//   ctx.isOpen(row, fallback), ctx.toggle(row, open)   «СРС и описание» of a lesson, opened or closed by hand
//   ctx.confirmRemoveUnit(n)     asks before the last unit, which has lessons, is removed
// A typed value goes into the state at once and the screen is not redrawn: the caret stays where it is.

const describedBy = (...ids) => ids.filter(Boolean).join(' ') || null;

// A labelled control: label (or a label read out only), hint, the control, the error line.
// kind: 'input' | 'textarea' | 'select'. value() reads the state, set(v) writes it.
export function boundField(ctx, { id, key, kind = 'input', label, hint = null, hideLabel = false, placeholder = null, rows = 3, options = null,
  className = '', inputMode = null, maxLength = null, value, set }) {
  const code = key ? ctx.error(key) : null;
  const hintId = hint ? id + '-hint' : null;
  const errorId = id + '-error';
  const common = {
    id, name: id, class: 'field__input' + (kind === 'select' ? ' field__select' : '') + (kind === 'textarea' ? ' field__textarea' : ''),
    disabled: ctx.readOnly, 'aria-invalid': code ? 'true' : null, 'aria-describedby': describedBy(hintId, code ? errorId : null),
  };
  let control;
  const shown = value();
  if (kind === 'select') {
    control = el('select', { ...common, onchange: () => { set(control.value); ctx.typed(key, errorId, control); } },
      options.map((option) => el('option', { value: option.value }, option.label)));
    control.value = shown === null || shown === undefined ? '' : String(shown);
  } else if (kind === 'textarea') {
    control = el('textarea', { ...common, rows: String(rows), placeholder, maxlength: maxLength, oninput: () => { set(control.value); ctx.typed(key, errorId, control); } });
    control.value = shown ?? '';
  } else {
    control = el('input', {
      ...common, type: 'text', value: shown === null || shown === undefined ? '' : String(shown), placeholder, inputmode: inputMode, maxlength: maxLength,
      autocomplete: 'off', oninput: () => { set(control.value); ctx.typed(key, errorId, control); },
    });
  }
  return el('div', { class: ('field ' + className).trim() },
    el('label', { class: hideLabel ? 'visually-hidden' : 'field__label', for: id }, label),
    control,
    hint ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
    code ? el('p', { class: 'field__error', id: errorId }, icon('alert'), ctx.errorText(key, code)) : null);
}

// An error of a whole list (too many points, no unit at all): a line under its title.
export function listError(ctx, key, id) {
  const code = ctx.error(key);
  return code ? el('p', { class: 'field__error', id }, icon('alert'), ctx.errorText(key, code)) : null;
}

// Up, down and remove for the item at `index` of a list of `count`; ids `<base>-up`, `-down`, `-remove`.
// labels: { up, down, remove } read out and shown as tooltips. onMove(step), onRemove().
export function rowActions(base, index, count, labels, onMove, onRemove) {
  return el('div', { class: 'row-tools' },
    iconButton({ id: base + '-up', iconName: 'chevron', label: labels.up, className: 'row-tools__up', onClick: () => onMove(-1), attrs: { disabled: index === 0 } }),
    iconButton({ id: base + '-down', iconName: 'chevron', label: labels.down, className: 'row-tools__down', onClick: () => onMove(1), attrs: { disabled: index === count - 1 } }),
    iconButton({ id: base + '-remove', iconName: 'trash', label: labels.remove, className: 'row-tools__remove', onClick: onRemove }));
}

// Where focus goes after an item moved: the same arrow at the new place, or the other one at the edge.
export function movedFocus(base, to, count, step) {
  const same = step < 0 ? 'up' : 'down';
  const atEdge = step < 0 ? to === 0 : to === count - 1;
  return `${base}-${to}-${atEdge ? (same === 'up' ? 'down' : 'up') : same}`;
}

// A list of points (knowledge, skills…): a numbered field each, arrows and «Удалить»; «Добавить пункт» under it,
// «N из 100» beside the title. get() and put(list) read and write the list in the state.
export function pointList(ctx, { id, key, title, hint, max, multiline, get, put }) {
  const items = get();
  const titleId = id + '-title';
  const count = items.length;
  const full = count >= max;
  return el('section', { class: 'points', 'aria-labelledby': titleId },
    el('div', { class: 'points__head' },
      el('h3', { class: 'points__title', id: titleId }, title),
      el('span', { class: 'points__count' + (full ? ' is-full' : ''), id: id + '-count' }, t('sform.list.count', { n: count, max }))),
    hint ? el('p', { class: 'points__hint' }, hint) : null,
    listError(ctx, key, id + '-list-error'),
    count === 0 ? el('p', { class: 'points__empty' }, t('sform.list.empty')) : el('ol', { class: 'points__list' }, items.map((_, i) => {
      const base = `${id}-${i}`;
      return el('li', { class: 'point' },
        el('span', { class: 'point__number', 'aria-hidden': 'true' }, String(i + 1)),
        boundField(ctx, {
          id: base, key: `${key}.${i}.text`, kind: multiline ? 'textarea' : 'input', rows: 2, hideLabel: true, className: 'point__field',
          label: t('sform.list.item', { list: title, n: i + 1 }), value: () => get()[i], set: (v) => { get()[i] = v; },
        }),
        ctx.readOnly ? null : rowActions(base, i, count, {
          up: t('sform.item.up', { n: i + 1 }), down: t('sform.item.down', { n: i + 1 }), remove: t('sform.item.remove', { n: i + 1 }),
        }, (step) => ctx.change(() => put(listMove(get(), i, step)), movedFocus(id, i + step, count, step), 'move'),
        () => ctx.change(() => put(listRemove(get(), i)), count > 1 ? `${id}-${Math.min(i, count - 2)}-remove` : id + '-add', 'remove')));
    })),
    ctx.readOnly ? null : el('button', {
      type: 'button', id: id + '-add', class: 'button button--secondary points__add', disabled: full,
      onclick: () => ctx.change(() => put(listAdd(get(), '')), `${id}-${count}`),
    }, icon('plus'), t('sform.list.add')));
}

// ---- The table of the lessons of one kind in a unit ----

const WITH_FORMS = ['practice', 'seminar', 'lab'];
const COLLAPSED = ['seminar', 'lab'];
const HOURS = { lesson: [2, 4], control: [0, 2] };

// '4' -> 4, '' -> null; anything else stays as typed, and the server names it at its field.
export function numberOf(text) {
  const value = String(text ?? '').trim();
  if (value === '') return null;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function hoursOptions(kind, current) {
  const allowed = HOURS[kind === 'control' ? 'control' : 'lesson'];
  const options = allowed.map((n) => ({ value: String(n), label: t('sform.plan.hoursN', { n }) }));
  if (!allowed.includes(current)) options.unshift({ value: current === null || current === undefined ? '' : String(current), label: current === null || current === undefined ? '—' : t('sform.plan.hoursN', { n: current }) });
  return options;
}

// The lessons of one kind in unit `unit` (1, 2…): a row each — №, topic, hours, the forms of current control for the
// practical kinds — with «СРС, ч» and «Описание» under a disclosure. get() and put(list) read and write the rows;
// numbers: tableNumbers of the plan. Empty seminars and labs fold into one «Добавить …» button.
export function lessonTable(ctx, { unit, kind, get, put, numbers, emptyRow }) {
  const rows = get();
  const id = `sf-plan-u${unit}-${kind}`;
  const titleId = id + '-title';
  const add = () => ctx.change(() => put(listAdd(get(), emptyRow())), `${id}-${rows.length}-name`);
  if (rows.length === 0 && (COLLAPSED.includes(kind) || ctx.readOnly)) {
    return ctx.readOnly ? null : el('button', { type: 'button', id: id + '-add', class: 'ltable-fold', 'data-kind': kind, onclick: add },
      icon('plus'), t('sform.plan.add.' + kind));
  }
  const forms = WITH_FORMS.includes(kind);
  const control = kind === 'control';
  const hours = rows.reduce((sum, row) => sum + (typeof row.hours === 'number' ? row.hours : 0), 0);
  return el('section', { class: 'ltable' + (forms ? ' ltable--forms' : ''), 'data-kind': kind, 'aria-labelledby': titleId },
    el('div', { class: 'ltable__head' },
      el('h4', { class: 'ltable__title', id: titleId }, t('sform.plan.table.' + kind)),
      rows.length > 0 ? el('span', { class: 'ltable__sum' }, t('sform.plan.hoursN', { n: hours })) : null,
      control ? el('p', { class: 'ltable__hint', id: id + '-hint' }, t('sform.plan.controlHint')) : null),
    listError(ctx, `u${unit}.${kind}`, id + '-list-error'),
    rows.length > 0 ? el('div', { class: 'ltable__cols', 'aria-hidden': 'true' },
      el('span', {}, t('sform.plan.col.number')),
      el('span', {}, t(control ? 'sform.plan.col.controlName' : 'sform.plan.col.topic')),
      el('span', {}, t('sform.plan.col.hours')),
      forms ? el('span', {}, t('sform.plan.col.forms')) : null) : null,
    rows.length > 0 ? el('ol', { class: 'ltable__rows' }, rows.map((row, i) => lessonRow(ctx, {
      unit, kind, i, count: rows.length, id, row, get, put, number: numbers.get(`${unit}.${kind}.${i}`), forms, control,
    }))) : null,
    ctx.readOnly ? null : el('button', { type: 'button', id: id + '-add', class: 'button button--secondary ltable__add', onclick: add },
      icon('plus'), t('sform.plan.add.' + kind)));
}

function lessonRow(ctx, { unit, kind, i, count, id, row, get, put, number, forms, control }) {
  const base = `${id}-${i}`;
  const key = `u${unit}.${kind}.${i}`;
  const label = t('lessonType.short.' + kind) + (number ?? '');
  const field = (name) => t('sform.plan.field', { label, field: t('sform.plan.col.' + name) });
  const row$ = () => get()[i];
  const details = ['selfHours', 'description'];
  // Closed unless opened by hand or holding an error; closed, it says what is inside: «СРС 2 ч · описание».
  const open = ctx.isOpen(row, details.some((name) => ctx.peek(`${key}.${name}`)));
  const self = row.selfHours !== null && row.selfHours !== undefined && row.selfHours !== '';
  const described = String(row.description ?? '').trim() !== '';
  const summary = [self ? t('sform.plan.moreSelf', { n: row.selfHours }) : null, described ? t('sform.plan.moreDescribed') : null].filter(Boolean);
  const detailsId = base + '-details';
  return el('li', { class: 'lrow' + (forms ? ' lrow--forms' : ''), 'data-kind': kind },
    el('span', { class: 'lrow__no', title: t('lessonType.' + kind) }, label),
    boundField(ctx, {
      id: base + '-name', key: key + '.name', label: field(control ? 'controlName' : 'topic'), className: 'lrow__name',
      placeholder: control ? t('sform.plan.controlPlaceholder', { n: unit }) : null, maxLength: 200,
      value: () => row$().name, set: (v) => { row$().name = v; },
    }),
    boundField(ctx, {
      id: base + '-hours', key: key + '.hours', kind: 'select', label: field('hours'), className: 'lrow__hours',
      options: hoursOptions(kind, row.hours), value: () => row$().hours, set: (v) => { row$().hours = numberOf(v); },
    }),
    forms ? boundField(ctx, {
      id: base + '-forms', key: key + '.controlForms', label: field('forms'), className: 'lrow__forms', maxLength: 200,
      value: () => row$().controlForms, set: (v) => { row$().controlForms = v; },
    }) : null,
    ctx.readOnly ? null : rowActions(base, i, count, {
      up: t('sform.lesson.up', { label }), down: t('sform.lesson.down', { label }), remove: t('sform.lesson.remove', { label }),
    }, (step) => ctx.change(() => put(listMove(get(), i, step)), movedFocus(id, i + step, count, step), 'move'),
    () => ctx.change(() => put(listRemove(get(), i)), count > 1 ? `${id}-${Math.min(i, count - 2)}-remove` : id + '-add', 'remove')),
    // a version that is not edited shows the disclosure only where there is something in it
    ctx.readOnly && summary.length === 0 ? null : el('button', {
      type: 'button', id: base + '-more', class: 'lrow__more', 'aria-expanded': String(open), 'aria-controls': detailsId,
      onclick: () => ctx.change(() => ctx.toggle(row, !open), base + '-more'),
    }, icon('chevron', 'lrow__chevron'), t('sform.plan.more'),
    !open && summary.length > 0 ? el('span', { class: 'lrow__summary' }, summary.join(' · ')) : null),
    ctx.readOnly && summary.length === 0 ? null : el('div', { class: 'lrow__details', id: detailsId, hidden: !open },
      boundField(ctx, {
        id: base + '-self', key: key + '.selfHours', label: field('self'), className: 'lrow__self', inputMode: 'numeric', maxLength: 3,
        value: () => row$().selfHours, set: (v) => { row$().selfHours = numberOf(v); },
      }),
      boundField(ctx, {
        id: base + '-desc', key: key + '.description', kind: 'textarea', rows: 2, label: field('description'), className: 'lrow__desc', maxLength: 1000,
        value: () => row$().description, set: (v) => { row$().description = v; },
      })));
}

// ---- A list of entries of several fields (a work of СРС, a book, a program, a row of the grading) ----

// The entries as numbered cards: the name of the entry and its arrows on top, its fields under them; «Добавить …»
// under the list, «N из 100» beside the title. get() and put(list) read and write the list in the state; empty() is a
// new entry; first: the field focus goes to in a new entry; itemName(n) names the entry «Работа 1», «Книга 2»;
// body(i, base, key, row$) gives the fields of entry i (base: the start of its ids, key: of its error keys,
// row$(): the entry in the state).
export function entryList(ctx, { id, key, title = null, hint = null, max, get, put, empty, first, addLabel, itemName, body, className = '', titleLevel = 'h3' }) {
  const items = get();
  const titleId = id + '-title';
  const count = items.length;
  const full = count >= max;
  return el('section', { class: ('entries ' + className).trim(), 'aria-labelledby': title ? titleId : null, 'aria-label': title ? null : addLabel },
    title ? el('div', { class: 'points__head' },
      el(titleLevel, { class: 'points__title', id: titleId }, title),
      el('span', { class: 'points__count' + (full ? ' is-full' : ''), id: id + '-count' }, t('sform.list.count', { n: count, max }))) : null,
    hint ? el('p', { class: 'points__hint' }, hint) : null,
    listError(ctx, key, id + '-list-error'),
    count === 0 ? el('p', { class: 'points__empty' }, t('sform.list.empty')) : el('ol', { class: 'entries__list' }, items.map((_, i) => {
      const base = `${id}-${i}`;
      const name = itemName(i + 1);
      return el('li', { class: 'entry' },
        el('div', { class: 'entry__head' },
          el('span', { class: 'entry__name', id: base + '-name-label' }, name),
          ctx.readOnly ? null : rowActions(base, i, count, {
            up: t('sform.entry.up', { name }), down: t('sform.entry.down', { name }), remove: t('sform.entry.remove', { name }),
          }, (step) => ctx.change(() => put(listMove(get(), i, step)), movedFocus(id, i + step, count, step), 'move'),
          () => ctx.change(() => put(listRemove(get(), i)), count > 1 ? `${id}-${Math.min(i, count - 2)}-remove` : id + '-add', 'remove'))),
        el('div', { class: 'entry__body', role: 'group', 'aria-labelledby': base + '-name-label' }, body(i, base, `${key}.${i}`, () => get()[i])));
    })),
    ctx.readOnly ? null : el('button', {
      type: 'button', id: id + '-add', class: 'button button--secondary points__add', disabled: full,
      onclick: () => ctx.change(() => put(listAdd(get(), empty())), `${id}-${count}-${first}`, 'add'),
    }, icon('plus'), addLabel));
}

// A field of an entry: id `<base>-<name>`, error key `<key>.<name>`; number: the value is kept as a number.
export function entryField(ctx, { base, key, name, row$, label, kind = 'input', hint = null, rows = 2, number = false, className = '', maxLength = 200, options = null,
  inputMode = null, hideLabel = false, placeholder = null }) {
  return boundField(ctx, {
    id: `${base}-${name}`, key: `${key}.${name}`, kind, label, hint, rows, options, className, maxLength, inputMode: inputMode ?? (number ? 'numeric' : null), hideLabel, placeholder,
    value: () => row$()[name], set: (v) => { row$()[name] = number ? numberOf(v) : v; },
  });
}
