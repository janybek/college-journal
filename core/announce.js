import { isDate, addDays } from './dates.js';

export const ANNOUNCE = Object.freeze({ titleMax: 120, textMax: 2000, defaultDays: 30, farDays: 366, perDay: 20, listMax: 100 });

const KINDS = ['all', 'teachers', 'group'];

export function checkAnnouncement(input, { today, groups }) {
  const src = input || {};
  const problems = [];
  const audience = src.audience;
  if (!KINDS.includes(audience)) problems.push({ field: 'audience', code: 'bad_value' });
  let groupId = '';
  if (audience === 'group') {
    if (typeof src.groupId !== 'string' || !groups.some((g) => g.id === src.groupId)) problems.push({ field: 'groupId', code: 'bad_ref' });
    else groupId = src.groupId;
  }
  const title = typeof src.title === 'string' ? src.title.trim() : '';
  if (!title) problems.push({ field: 'title', code: 'empty' });
  else if (title.length > ANNOUNCE.titleMax) problems.push({ field: 'title', code: 'too_long' });
  const text = typeof src.text === 'string' ? src.text.trim() : '';
  if (text.length > ANNOUNCE.textMax) problems.push({ field: 'text', code: 'too_long' });
  let expiresOn = '';
  if (src.expiresOn !== undefined && src.expiresOn !== null && src.expiresOn !== '') {
    if (typeof src.expiresOn !== 'string' || !isDate(src.expiresOn)) problems.push({ field: 'expiresOn', code: 'bad_value' });
    else if (src.expiresOn < today) problems.push({ field: 'expiresOn', code: 'in_past' });
    else if (src.expiresOn > addDays(today, ANNOUNCE.farDays)) problems.push({ field: 'expiresOn', code: 'too_far' });
    else expiresOn = src.expiresOn;
  }
  if (problems.length) return { value: null, problems };
  return { value: { audience, groupId, title, text, expiresOn }, problems };
}

export function lastDay(row) {
  return row.expiresOn || addDays(row.createdAt.slice(0, 10), ANNOUNCE.defaultDays);
}

export function isShown(row, today) {
  return row.removedAt === '' && today <= lastDay(row);
}

export function seenBy(row, viewer) {
  if (viewer.office) return true;
  if (row.authorId === viewer.id) return true;
  if (row.audience === 'all') return true;
  if (row.audience === 'teachers') return viewer.kind === 'staff' && !!viewer.teacher;
  if (row.audience === 'group') {
    return (viewer.kind === 'student' && viewer.groupId === row.groupId)
      || (viewer.kind === 'staff' && !!viewer.teacher && viewer.teachGroupIds.has(row.groupId));
  }
  return false;
}
