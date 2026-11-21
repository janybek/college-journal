import { t } from '../i18n.js';
import { el, badge, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { PLAN_KINDS, emptyItem, listAdd, tableNumbers, unitHasContent } from '../syllabusForm.js';
import { boundField, lessonTable, listError, numberOf, pointList } from './syllabusFormParts.js';

// The tabs of the syllabus form. renderTab(tab, ctx) draws the body of one tab from ctx.doc (the document being
// edited) and the form's answer ctx.form (the subject, the groups, the version). The pieces and ctx: syllabusFormParts.js.

const LIMIT = 100;   // points in a list (LIMITS.list on the server)
const UNITS = 20;    // units in a plan (LIMITS.units)

export function renderTab(tab, ctx) {
  if (tab === 'title') return titleTab(ctx);
  if (tab === 'goals') return goalsTab(ctx);
  if (tab === 'plan') return planTab(ctx);
  return emptyState('clock', el('p', { class: 'empty__title' }, t('sform.soon')));
}

// «Титул»

const textField = (ctx, name, extra = {}) => boundField(ctx, {
  id: 'sf-title-' + name, key: name, label: t('sform.field.' + name), maxLength: 200,
  value: () => ctx.doc.title[name], set: (v) => { ctx.doc.title[name] = v; }, ...extra,
});

const numberField = (ctx, name, extra = {}) => textField(ctx, name, {
  inputMode: 'numeric', maxLength: 4, className: 'field--short', set: (v) => { ctx.doc.title[name] = numberOf(v); }, ...extra,
});

const choice = (ctx, name, count, extra = {}) => textField(ctx, name, {
  kind: 'select', className: 'field--short',
  options: [{ value: '', label: t('sform.choose') }, ...Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))],
  set: (v) => { ctx.doc.title[name] = numberOf(v); }, ...extra,
});

function block(id, titleKey, ...fields) {
  return el('section', { class: 'sform-block', role: 'group', 'aria-labelledby': id },
    el('h3', { class: 'sform-block__title', id }, t(titleKey)),
    el('div', { class: 'sform-block__fields' }, fields));
}

function titleTab(ctx) {
  const { subject, syllabus } = ctx.form;
  const groups = subject.groups.map((group) => group.groupName).filter(Boolean);
  return [
    el('section', { class: 'sform-fixed', 'aria-labelledby': 'sf-fixed-title' },
      el('div', { class: 'sform-fixed__head' },
        el('h3', { class: 'sform-block__title', id: 'sf-fixed-title' }, t('sform.title.fixed')),
        el('p', { class: 'sform-fixed__hint' }, t('sform.title.fixedHint'))),
      el('dl', { class: 'facts sform-fixed__facts' },
        fact('sform.title.discipline', subject.name || '—'),
        fact('sform.title.teacher', subject.teacherName || '—'),
        fact('sform.title.groups', groups.length > 0 ? el('span', { class: 'badges' }, groups.map((name) => badge(name, 'primary'))) : '—'))),
    el('div', { class: 'sform-blocks' },
      block('sf-block-program', 'sform.title.block.program',
        textField(ctx, 'department'), textField(ctx, 'faculty'), textField(ctx, 'audience')),
      block('sf-block-year', 'sform.title.block.year',
        textField(ctx, 'academicYear', { hint: t('sform.field.academicYear.hint'), className: 'field--short', maxLength: 20 }),
        choice(ctx, 'course', 6),
        choice(ctx, 'planSemester', 8, { hint: t('sform.field.planSemester.hint.' + syllabus.semester), className: 'field--choice' })),
      block('sf-block-volume', 'sform.title.block.volume',
        numberField(ctx, 'credits'), numberField(ctx, 'totalHours'), numberField(ctx, 'classHours'), numberField(ctx, 'selfHours')),
      block('sf-block-contacts', 'sform.title.block.contacts',
        textField(ctx, 'contacts', { kind: 'textarea', rows: 3, hint: t('sform.field.contacts.hint'), maxLength: 5000, className: 'field--wide' }),
        textField(ctx, 'place', { hint: t('sform.field.place.hint'), className: 'field--wide' }))),
  ];
}

function fact(labelKey, value) {
  return el('div', { class: 'fact' }, el('dt', { class: 'fact__label' }, t(labelKey)), el('dd', { class: 'fact__value' }, value));
}

// «Цель и результаты»

const OUTCOMES = [['knowledge', true], ['skill', true], ['attitude', true], ['prerequisite', false], ['postrequisite', false]];

function goalsTab(ctx) {
  const goals = ctx.doc.goals;
  return [
    boundField(ctx, {
      id: 'sf-goals-goal', key: 'goal', kind: 'textarea', rows: 4, label: t('sform.goal'), hint: t('sform.goal.hint'), className: 'sform-goal', maxLength: 5000,
      value: () => goals.goal, set: (v) => { goals.goal = v; },
    }),
    el('div', { class: 'sform-outcomes' }, OUTCOMES.map(([list, multiline]) => pointList(ctx, {
      id: 'sf-goals-' + list, key: list, title: t('sform.list.' + list), hint: t('sform.list.hint.' + list), max: LIMIT, multiline,
      get: () => ctx.doc.goals[list] || [], put: (items) => { ctx.doc.goals[list] = items; },
    }))),
  ];
}

// «Тематические планы»

function planTab(ctx) {
  const plan = ctx.doc.plan;
  const units = plan.units;
  const numbers = tableNumbers(units);
  const last = units[units.length - 1];
  return [
    el('div', { class: 'units-bar' },
      el('p', { class: 'units-bar__count', id: 'sf-plan-count' }, t('sform.plan.units', { n: units.length })),
      ctx.readOnly ? null : el('div', { class: 'units-bar__actions' },
        el('button', {
          type: 'button', id: 'sf-plan-add-unit', class: 'button button--secondary', disabled: units.length >= UNITS,
          onclick: () => ctx.change(() => { plan.units = listAdd(plan.units, emptyItem('unit')); }, `sf-plan-u${units.length + 1}-title`),
        }, icon('plus'), t('sform.plan.addUnit')),
        el('button', {
          type: 'button', id: 'sf-plan-remove-unit', class: 'button button--secondary', disabled: units.length <= 1,
          onclick: () => (unitHasContent(last) ? ctx.confirmRemoveUnit(units.length) : ctx.change(() => { plan.units = plan.units.slice(0, -1); }, 'sf-plan-remove-unit')),
        }, icon('trash'), t('sform.plan.removeUnit'))),
      listError(ctx, 'units', 'sf-plan-units-error')),
    units.map((unit, i) => unitCard(ctx, unit, i + 1, numbers)),
    totals(units),
  ];
}

function unitCard(ctx, unit, n, numbers) {
  const titleId = `sf-plan-u${n}-head`;
  return el('section', { class: 'unit-card', 'aria-labelledby': titleId },
    el('header', { class: 'unit-card__head' },
      el('h3', { class: 'unit-card__name', id: titleId }, t('syllabus.unitN', { n })),
      boundField(ctx, {
        id: `sf-plan-u${n}-title`, key: `u${n}.title`, label: t('sform.plan.unitTitle', { n }), hideLabel: true, className: 'unit-card__title',
        placeholder: t('sform.plan.unitTitlePlaceholder'), maxLength: 200,
        value: () => ctx.doc.plan.units[n - 1].title, set: (v) => { ctx.doc.plan.units[n - 1].title = v; },
      })),
    el('div', { class: 'unit-card__tables' }, PLAN_KINDS.map((kind) => lessonTable(ctx, {
      unit: n, kind, numbers,
      get: () => ctx.doc.plan.units[n - 1][kind],
      put: (rows) => { ctx.doc.plan.units[n - 1][kind] = rows; },
      emptyRow: () => emptyItem(kind === 'control' ? 'control' : 'lesson'),
    }))));
}

const PAIR_HOURS = 2;

// Under the cards: the hours of the lectures, of the practical kinds and of the control, and the pairs they take.
function totals(units) {
  const sum = (kinds) => units.reduce((n, unit) => n + kinds.reduce((m, kind) => m + (unit[kind] || [])
    .reduce((k, row) => k + (typeof row.hours === 'number' ? row.hours : 0), 0), 0), 0);
  const lecture = sum(['lecture']);
  const practice = sum(['practice', 'seminar', 'lab']);
  const control = sum(['control']);
  const pairs = Math.floor((lecture + practice + control) / PAIR_HOURS);
  return el('section', { class: 'plan-sum', 'aria-labelledby': 'sf-plan-sum-title' },
    el('h3', { class: 'plan-sum__title', id: 'sf-plan-sum-title' }, t('sform.plan.totals')),
    el('dl', { class: 'plan-sum__list' },
      [['lecture', lecture], ['practice', practice], ['control', control]].map(([key, hours]) => el('div', { class: 'plan-sum__item', 'data-kind': key },
        el('dt', {}, t('sform.plan.total.' + key)), el('dd', {}, t('sform.plan.hoursN', { n: hours })))),
      el('div', { class: 'plan-sum__item plan-sum__item--pairs' }, el('dt', {}, t('sform.plan.total.pairs')), el('dd', {}, String(pairs)))));
}
