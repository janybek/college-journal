// The bell times a person can pick on «Настройки семестра»: every 5 minutes from 07:00 to 22:25. A list, not a
// typed time, so 02:00 cannot be picked instead of 14:00. 22:25 + 90 minutes = 23:55, so any time on the list
// passes the server rule «a class ends by 23:59». No DOM.
import { isTime, minutesOf, addMinutes } from './dates.js';

export const BELL_FIRST = '07:00';
export const BELL_LAST = '22:25';
export const BELL_STEP = 5;

const TIMES = [];
for (let m = minutesOf(BELL_FIRST); m <= minutesOf(BELL_LAST); m += BELL_STEP) TIMES.push(addMinutes('00:00', m));

export function bellTimes() {
  return [...TIMES];
}

// The choices of one bell. A saved time that is not on the list (typed before the list, or set in the table)
// comes first and is marked, so it is shown and kept until the person picks another one.
export function bellOptions(current) {
  const options = TIMES.map((value) => ({ value, offList: false }));
  if (isTime(current) && !TIMES.includes(current)) options.unshift({ value: current, offList: true });
  return options;
}

// The bell of a new class: the first time on the list not earlier than the end of the last class plus a break;
// '' when there is none.
export function nextBell(last, pairMinutes, gap) {
  if (!isTime(last)) return '';
  const earliest = minutesOf(last) + pairMinutes + gap;
  return TIMES.find((time) => minutesOf(time) >= earliest) ?? '';
}
