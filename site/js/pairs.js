import { addDays } from './dates.js';

// Pairs of the schedule screens (PairView from the server), without the DOM.

// [{ date, pairs }] for `days` days in a row from `from`; inside a day the pairs go by their number.
export function groupByDay(pairs, from, days = 7) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, pairs: pairs.filter((pair) => pair.date === date).sort((a, b) => a.slot - b.slot) };
  });
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
