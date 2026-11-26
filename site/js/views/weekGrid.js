import { t } from '../i18n.js';
import { el, badge } from '../ui.js';
import { dayParts } from '../dates.js';
import { cellPairs, examDayLabel, gridDays } from '../pairs.js';
import { gridRows } from '../dirInfo.js';
import { dayMonth } from './pairParts.js';

// The week of a room or of a teacher as a grid: the bells are its rows, the days its columns. data: { from, today, bells,
// exam, holidays, pairs }; cell(pairsOfCell, isToday) draws one cell (a td). Everything from the server goes in as text.
export function weekGrid({ data, cell }) {
  const dates = gridDays(data.pairs, data.from);
  const rows = gridRows(data.bells, data.pairs);
  const exam = data.exam?.start ? data.exam : null;
  const dayHead = (date) => {
    const examKey = examDayLabel(date, exam);
    return el('th', { scope: 'col', class: 'room-grid__day' + (date === data.today ? ' is-today' : '') },
      el('span', { class: 'room-grid__name' }, t('date.weekday.' + dayParts(date).weekday)),
      el('span', { class: 'room-grid__date muted' }, dayMonth(date)),
      date === data.today ? badge(t('pairs.today'), 'primary', true) : null,
      examKey ? badge(t(examKey), 'warning') : null,
      data.holidays.includes(date) ? badge(t('dir.card.holiday'), 'neutral') : null);
  };
  return el('div', { class: 'table-scroll room-week' },
    el('table', { class: 'room-grid', 'data-days': dates.length },
      el('thead', {}, el('tr', {}, el('th', { class: 'room-grid__corner' }), dates.map(dayHead))),
      el('tbody', {}, rows.map((row) => el('tr', {},
        el('th', { scope: 'row', class: 'room-grid__slot' },
          el('span', { class: 'room-grid__pair' }, t('settings.pairN', { n: row.slot })),
          el('span', { class: 'room-grid__time muted' }, row.time)),
        dates.map((date) => cell(cellPairs(data.pairs, date, row.slot), date === data.today)))))));
}
