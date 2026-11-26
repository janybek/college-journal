import { t } from '../i18n.js';
import { el, badge, emptyState, iconButton, note } from '../ui.js';
import { icon } from '../icons.js';
import { PLAN_KINDS, canMove, emptyItem, listAdd, moveLesson, pairNumbers, tableNumbers, unitAbout, unitHasContent } from '../syllabusForm.js';
import { teachersText } from '../syllabus.js';
import { shortFio } from '../documents.js';
import { fileBlock } from './syllabusAttach.js';
import { boundField, entryField, entryList, lessonTable, listError, numberOf, pointList } from './syllabusFormParts.js';

// The tabs of the syllabus form. renderTab(tab, ctx) draws the body of one tab from ctx.doc (the document being
// edited), ctx.saved (the document as last saved: the units of the plan the other tabs refer to) and the form's
// answer ctx.form (the subject, the groups, the version). ctx.planDirty: «Тематические планы» has unsaved changes.
// The pieces and the rest of ctx: syllabusFormParts.js.

const LIMIT = 100;   // points in a list (LIMITS.list on the server)
const UNITS = 20;    // units in a plan (LIMITS.units)

const TABS_DRAWN = {
  title: titleTab, goals: goalsTab, plan: planTab, selfWork: selfWorkTab, literature: literatureTab, software: softwareTab,
  policies: policiesTab, units: unitsTab, order: orderTab,
};

export function renderTab(tab, ctx) {
  return TABS_DRAWN[tab](ctx);
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
    fileBlock({ syllabusId: syllabus.id, file: syllabus.file, canEdit: !ctx.readOnly, onChange: ctx.fileChanged }),
    el('section', { class: 'sform-fixed', 'aria-labelledby': 'sf-fixed-title' },
      el('div', { class: 'sform-fixed__head' },
        el('h3', { class: 'sform-block__title', id: 'sf-fixed-title' }, t('sform.title.fixed')),
        el('p', { class: 'sform-fixed__hint' }, t('sform.title.fixedHint'))),
      el('dl', { class: 'facts sform-fixed__facts' },
        fact('sform.title.discipline', subject.name || '—'),
        fact('sform.title.teacher', teachersText(ctx.form.line) || shortFio(subject.teacherName) || '—'),
        ctx.form.line && ctx.form.line.responsibleName ? fact('sform.title.responsible', shortFio(ctx.form.line.responsibleName)) : null,
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
  // the lessons of the last unit, its description and its books go with it: then the form asks first
  const about = unitAbout(ctx.doc.units, units.length);
  const asks = unitHasContent(last) || about.texts || about.books > 0;
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
          onclick: () => (asks ? ctx.confirmRemoveUnit(units.length) : ctx.change(() => { plan.units = plan.units.slice(0, -1); }, 'sf-plan-remove-unit', 'remove')),
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

// ---- The units of the saved plan, for the tabs that refer to them ----

// [{ n, title }] of the saved plan; a new draft has one blank unit only on the screen, which is no unit yet.
function savedUnits(ctx) {
  const units = (ctx.saved.plan && ctx.saved.plan.units) || [];
  if (units.length === 1 && !unitHasContent(units[0]) && !String(units[0].title ?? '').trim()) return [];
  return units.map((unit, i) => ({ n: i + 1, title: String(unit.title ?? '').trim() }));
}

const unitName = ({ n, title }) => (title ? t('sform.unitNamed', { n, title }) : t('syllabus.unitN', { n }));

// The units come from the saved plan: changes of «Тематические планы» show here after that tab is saved.
const planNote = (ctx) => (ctx.planDirty && !ctx.readOnly ? note('info', t('sform.planUnsaved'), { class: 'sform-lead-note' }) : null);

const lead = (key) => el('p', { class: 'sform-lead' }, t(key));

// «СРС»

function selfWorkTab(ctx) {
  const units = savedUnits(ctx);
  const options = (current) => {
    const list = [{ value: '', label: t('sform.self.wholeCourse') }, ...units.map((unit) => ({ value: String(unit.n), label: unitName(unit) }))];
    if (typeof current === 'number' && !units.some((unit) => unit.n === current)) list.push({ value: String(current), label: t('sform.self.noUnit', { n: current }) });
    return list;
  };
  return [
    lead('sform.self.lead'),
    planNote(ctx),
    entryList(ctx, {
      id: 'sf-self', key: 'items', title: t('sform.self.title'), max: LIMIT, first: 'name', className: 'entries--self',
      get: () => ctx.doc.selfWork.items, put: (items) => { ctx.doc.selfWork.items = items; }, empty: () => emptyItem('selfWork'),
      addLabel: t('sform.self.add'), itemName: (n) => t('sform.self.item', { n }),
      body: (i, base, key, row$) => [
        entryField(ctx, { base, key, row$, name: 'name', label: t('sform.self.name'), className: 'entry__c3' }),
        entryField(ctx, { base, key, row$, name: 'unit', kind: 'select', label: t('sform.self.unit'), number: true, options: options(row$().unit), className: 'entry__c2' }),
        entryField(ctx, { base, key, row$, name: 'hours', label: t('sform.self.hours'), number: true, maxLength: 3, className: 'entry__c1' }),
        entryField(ctx, { base, key, row$, name: 'tasks', kind: 'textarea', rows: 3, label: t('sform.self.tasks'), hint: t('sform.self.tasksHint'), maxLength: 5000, className: 'entry__full' }),
      ],
    }),
  ];
}

// «Литература»: a book of the course or of a unit.

function bookFields(ctx, base, key, row$) {
  return [
    entryField(ctx, { base, key, row$, name: 'authors', label: t('sform.book.authors'), className: 'entry__c3' }),
    entryField(ctx, { base, key, row$, name: 'title', label: t('sform.book.title'), className: 'entry__c3' }),
    entryField(ctx, { base, key, row$, name: 'year', label: t('sform.book.year'), inputMode: 'numeric', maxLength: 20, className: 'entry__c1' }),
    entryField(ctx, { base, key, row$, name: 'publisher', label: t('sform.book.publisher'), className: 'entry__c2' }),
    entryField(ctx, { base, key, row$, name: 'availability', label: t('sform.book.availability'), placeholder: t('sform.book.availabilityHint'), className: 'entry__c3' }),
  ];
}

function bookList(ctx, { id, key, title, hint = null, get, put, titleLevel = 'h3' }) {
  return entryList(ctx, {
    id, key, title, hint, max: LIMIT, first: 'authors', get, put, empty: () => emptyItem('book'), titleLevel, className: 'entries--books',
    addLabel: t('sform.book.add'), itemName: (n) => t('sform.book.item', { n }), body: (i, base, keyBase, row$) => bookFields(ctx, base, keyBase, row$),
  });
}

function literatureTab(ctx) {
  const lit = ctx.doc.literature;
  return [
    lead('sform.literature.lead'),
    el('div', { class: 'sform-stack' },
      bookList(ctx, { id: 'sf-lit-main', key: 'main', title: t('sform.literature.main'), get: () => lit.main, put: (list) => { lit.main = list; } }),
      bookList(ctx, { id: 'sf-lit-extra', key: 'extra', title: t('sform.literature.extra'), get: () => lit.extra, put: (list) => { lit.extra = list; } })),
  ];
}

// «Программы и ресурсы»

function softwareTab(ctx) {
  const software = ctx.doc.software;
  return [
    lead('sform.software.lead'),
    entryList(ctx, {
      id: 'sf-soft', key: 'items', title: t('sform.software.title'), max: LIMIT, first: 'name', className: 'entries--software',
      get: () => software.items, put: (items) => { software.items = items; }, empty: () => emptyItem('software'),
      addLabel: t('sform.software.add'), itemName: (n) => t('sform.software.item', { n }),
      body: (i, base, key, row$) => [
        entryField(ctx, { base, key, row$, name: 'name', label: t('sform.software.name'), className: 'entry__c3' }),
        entryField(ctx, { base, key, row$, name: 'link', label: t('sform.software.link'), hint: t('sform.software.linkHint'), inputMode: 'url', maxLength: 500, className: 'entry__c3' }),
      ],
    }),
  ];
}

// «Политики»: the grading as a scale of four grades, then the rules of behaviour and of academic ethics.

const GRADES = [['Fail', 'fail'], ['Fair', 'fair'], ['Good', 'good'], ['Excellent', 'excellent']];

function gradingBody(ctx, base, key, row$) {
  return [
    entryField(ctx, { base, key, row$, name: 'name', label: t('sform.grading.name'), placeholder: t('sform.grading.nameHint'), className: 'entry__c5' }),
    entryField(ctx, { base, key, row$, name: 'maxPoints', label: t('sform.grading.maxPoints'), number: true, maxLength: 3, className: 'entry__c1' }),
    el('div', { class: 'grade-scale entry__full', role: 'group', 'aria-label': t('sform.grading.scale') },
      GRADES.map(([field, grade]) => {
        const name = t('sform.grading.grade.' + grade);
        return el('div', { class: 'grade-scale__step', 'data-grade': grade },
          el('p', { class: 'grade-scale__name', 'aria-hidden': 'true' }, name),
          entryField(ctx, { base, key, row$, name: 'range' + field, label: t('sform.grading.range', { grade: name }), className: 'grade-scale__range', hideLabel: true,
            placeholder: t('sform.grading.rangePlaceholder') }),
          entryField(ctx, {
            base, key, row$, name: 'criteria' + field, kind: 'textarea', rows: 3, label: t('sform.grading.criteria', { grade: name }),
            className: 'grade-scale__criteria', maxLength: 5000, hideLabel: true, placeholder: t('sform.grading.criteriaPlaceholder'),
          }));
      })),
  ];
}

function rules(ctx, list, sanction) {
  const policies = ctx.doc.policies;
  return el('div', { class: 'rules' },
    pointList(ctx, {
      id: 'sf-pol-' + list, key: list, title: t('sform.policies.' + list), hint: t('sform.policies.' + list + 'Hint'), max: LIMIT, multiline: true,
      get: () => policies[list] || [], put: (items) => { policies[list] = items; },
    }),
    boundField(ctx, {
      id: 'sf-pol-' + sanction, key: sanction, label: t('sform.policies.sanction'), hint: t('sform.policies.sanctionHint'), maxLength: 200, className: 'rules__sanction',
      value: () => policies[sanction], set: (v) => { policies[sanction] = v; },
    }));
}

function policiesTab(ctx) {
  const policies = ctx.doc.policies;
  return [
    entryList(ctx, {
      id: 'sf-grading', key: 'grading', title: t('sform.grading.title'), hint: t('sform.grading.hint'), max: LIMIT, first: 'name', className: 'entries--grading',
      get: () => policies.grading, put: (items) => { policies.grading = items; }, empty: () => emptyItem('grading'),
      addLabel: t('sform.grading.add'), itemName: (n) => t('sform.grading.item', { n }), body: (i, base, key, row$) => gradingBody(ctx, base, key, row$),
    }),
    el('div', { class: 'sform-outcomes' }, rules(ctx, 'behavior', 'sanctionBehavior'), rules(ctx, 'ethics', 'sanctionEthics')),
  ];
}

// «Описание юнитов»: a card for each unit of the saved plan. A unit without a description has no entry in the
// state until something is typed into it.

const UNIT_TEXTS = [['description', 4], ['questions', 4], ['guidance', 4], ['results', 3]];
const UNIT_HINTS = ['questions', 'guidance'];

function unitEntry(ctx, n, create) {
  const list = ctx.doc.units.units;
  let entry = list.find((u) => u.unit === n);
  if (!entry && create) {
    entry = { unit: n, title: '', description: '', questions: '', guidance: '', results: '', literature: [] };
    list.push(entry);
  }
  return entry || null;
}

function unitsTab(ctx) {
  const units = savedUnits(ctx);
  if (units.length === 0) return toPlan(ctx, 'sform.units.none');
  return [
    lead('sform.units.lead'),
    planNote(ctx),
    units.map((unit) => unitDescription(ctx, unit)),
  ];
}

// Nothing to show before the plan has lessons: a way to «Тематические планы».
function toPlan(ctx, key) {
  return emptyState('layers', el('p', { class: 'empty__title' }, t(key)),
    el('a', { class: 'button button--secondary', href: `#/syllabus-form/${ctx.form.syllabus.id}/plan` }, t('sform.units.toPlan')));
}

function unitDescription(ctx, unit) {
  const { n } = unit;
  const index = ctx.doc.units.units.findIndex((u) => u.unit === n);
  const headId = `sf-units-u${n}-head`;
  const none = [];
  return el('section', { class: 'unit-card unit-card--about', 'aria-labelledby': headId },
    el('header', { class: 'unit-card__head' },
      el('h3', { class: 'unit-card__name', id: headId }, t('syllabus.unitN', { n })),
      unit.title ? el('p', { class: 'unit-card__caption' }, unit.title) : null),
    el('div', { class: 'unit-about' }, UNIT_TEXTS.map(([field, rows]) => boundField(ctx, {
      id: `sf-units-u${n}-${field}`, key: index >= 0 ? `units.${index}.${field}` : null, kind: 'textarea', rows, maxLength: 5000,
      label: t('sform.units.' + field), hint: UNIT_HINTS.includes(field) ? t('sform.units.' + field + 'Hint') : null,
      value: () => (unitEntry(ctx, n, false) || {})[field] ?? '', set: (v) => { unitEntry(ctx, n, true)[field] = v; },
    }))),
    bookList(ctx, {
      id: `sf-units-u${n}-lit`, key: `u${n}.literature`, title: t('sform.units.literature'), titleLevel: 'h4',
      get: () => (unitEntry(ctx, n, false) || { literature: none }).literature, put: (list) => { unitEntry(ctx, n, true).literature = list; },
    }));
}

// «Порядок пар»: the lessons of the saved plan in the order of the pairs, unit by unit; arrows move a lesson inside
// its unit. The pairs are counted as they will be given: a lesson of 4 hours takes two.

function orderTab(ctx) {
  const lessons = ctx.doc.lessons || [];
  const blocked = ctx.planDirty;
  if (lessons.length === 0) return toPlan(ctx, 'sform.order.none');
  const pairs = pairNumbers(lessons);
  const titles = ((ctx.saved.plan && ctx.saved.plan.units) || []).map((unit) => String(unit.title ?? '').trim());
  const groups = [];
  lessons.forEach((lesson, i) => {
    const last = groups[groups.length - 1];
    if (last && last.unit === lesson.unit) last.items.push(i);
    else groups.push({ unit: lesson.unit, items: [i] });
  });
  const manual = ctx.saved.plan && ctx.saved.plan.manualOrder === true;
  return [
    el('div', { class: 'order-mode' + (manual ? ' is-manual' : ''), id: 'sf-order-mode' },
      icon(manual ? 'pencil' : 'layers', 'order-mode__icon'),
      el('p', {}, t(manual ? 'sform.order.manual' : 'sform.order.auto'))),
    blocked && !ctx.readOnly ? note('warning', t('sform.order.planUnsaved'), { class: 'sform-lead-note', id: 'sf-order-blocked' }) : null,
    el('div', { class: 'order' }, groups.map((group) => {
      const n = group.unit;
      const headId = `sf-order-u${n}`;
      return el('section', { class: 'order-unit', 'aria-labelledby': headId },
        el('h3', { class: 'order-unit__head', id: headId },
          el('span', { class: 'order-unit__name' }, t('syllabus.unitN', { n })),
          titles[n - 1] ? el('span', { class: 'order-unit__title' }, titles[n - 1]) : null),
        el('ol', { class: 'order-unit__list' }, group.items.map((i) => orderRow(ctx, lessons, i, pairs[i], blocked))));
    })),
  ];
}

function orderRow(ctx, lessons, i, pair, blocked) {
  const lesson = lessons[i];
  const kind = lesson.lessonKind;
  const label = t('lessonType.short.' + kind) + (lesson.number ?? '');
  const name = String(lesson.name ?? '').trim() || (kind === 'control' ? t('sform.plan.controlPlaceholder', { n: lesson.unit }) : '—');
  const where = pair.from === null ? null : pair.from === pair.to ? String(pair.from) : `${pair.from}–${pair.to}`;
  const base = `sf-order-${i}`;
  const move = (step) => {
    const next = moveLesson(ctx.doc.lessons, i, step);
    const to = i + step;
    const same = step < 0 ? 'up' : 'down';
    const focus = canMove(next, to, step) ? `sf-order-${to}-${same}` : `sf-order-${to}-${same === 'up' ? 'down' : 'up'}`;
    ctx.change(() => { ctx.doc.lessons = next; }, focus, 'move');
  };
  const arrow = (step, dir) => iconButton({
    id: `${base}-${dir}`, iconName: 'chevron', label: t('sform.lesson.' + dir, { label }), className: 'row-tools__' + dir,
    onClick: () => move(step), attrs: { disabled: blocked || !canMove(lessons, i, step) },
  });
  return el('li', { class: 'order-row', 'data-kind': kind },
    el('span', { class: 'order-row__pair' + (where === null ? ' is-mark' : ''), title: where === null ? t('sform.order.markHint') : null },
      el('span', { class: 'visually-hidden' }, where === null ? t('sform.order.markHint') : t('sform.order.pairs', { pairs: where })),
      el('span', { 'aria-hidden': 'true' }, where ?? '·')),
    el('span', { class: 'order-row__kind' }, t('lessonType.' + kind)),
    el('span', { class: 'order-row__text' },
      el('span', { class: 'order-row__label' }, label + '.'), ' ', el('span', { class: 'order-row__name' }, name)),
    el('span', { class: 'order-row__hours' }, t('sform.plan.hoursN', { n: typeof lesson.hours === 'number' ? lesson.hours : 0 })),
    ctx.readOnly ? null : el('div', { class: 'row-tools' }, arrow(-1, 'up'), arrow(1, 'down')));
}
