// Announcements: the list a person may see, writing and removing. The only module that writes the announcements.
// Who sees an announcement is decided by `seenBy`; the students table is never read: the group of a student is in his own row.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { ANNOUNCE, checkAnnouncement, isShown, lastDay, seenBy } from '../core/announce.js';

export const ANNOUNCE_TABLES = ['announcements', 'groups', 'staff', 'subjects'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasRole = (user, role) => Array.isArray(user.roles) && user.roles.includes(role);
const isOffice = (user) => hasRole(user, 'admin') || hasRole(user, 'dean');
const readRows = (store) => Object.fromEntries(ANNOUNCE_TABLES.map((t) => [t, store.list(t)]));

// The groups where the person leads a subject now.
function teachGroupIds(rows, user) {
  if (user.kind !== 'staff' || !hasRole(user, 'teacher')) return new Set();
  return new Set(rows.subjects.filter((s) => s.teacherId === user.id).map((s) => s.groupId));
}

function viewerOf(rows, user) {
  const base = { id: user.id, kind: user.kind, office: user.kind === 'staff' && (isOffice(user) || hasRole(user, 'prorector')) };
  if (user.kind === 'student') return { ...base, groupId: user.row.groupId, teacher: false, teachGroupIds: new Set() };
  return { ...base, groupId: '', teacher: hasRole(user, 'teacher'), teachGroupIds: teachGroupIds(rows, user) };
}

function canOf(rows, user, teach) {
  const byName = (list) => list.map((g) => ({ id: g.id, name: g.name })).sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id));
  if (user.kind === 'staff' && isOffice(user)) return { write: true, audiences: ['all', 'teachers', 'group'], groups: byName(rows.groups) };
  if (user.kind === 'staff' && teach.size > 0) return { write: true, audiences: ['group'], groups: byName(rows.groups.filter((g) => teach.has(g.id))) };
  return { write: false, audiences: [], groups: [] };
}

function itemOf(rows, row, user, today) {
  const group = row.audience === 'group' ? rows.groups.find((g) => g.id === row.groupId) : null;
  const author = rows.staff.find((p) => p.id === row.authorId);
  const own = row.authorId === user.id;
  return {
    id: row.id, title: row.title, text: row.text, audience: row.audience, groupName: group ? group.name : '',
    authorName: author ? author.fullName : '', createdAt: row.createdAt, until: lastDay(row), own,
    can: { remove: user.kind === 'staff' && (own || isOffice(user)) && isShown(row, today) },
  };
}

export function announceList(store, platform, user) {
  const rows = readRows(store);
  const today = localDate(platform.now());
  const viewer = viewerOf(rows, user);
  const items = rows.announcements.filter((r) => isShown(r, today) && seenBy(r, viewer))
    .sort((a, b) => cmp(b.createdAt, a.createdAt) || cmp(b.id, a.id))
    .slice(0, ANNOUNCE.listMax)
    .map((r) => itemOf(rows, r, user, today));
  return { today, can: canOf(rows, user, viewer.teachGroupIds), items };
}

export function saveAnnouncement(store, platform, data, user) {
  const rows = readRows(store);
  const now = platform.now();
  const today = localDate(now);
  if (!isOffice(user)) {
    if (data.audience !== 'group') throw new AppError('forbidden');
    const known = typeof data.groupId === 'string' && rows.groups.some((g) => g.id === data.groupId);
    if (known && !teachGroupIds(rows, user).has(data.groupId)) throw new AppError('forbidden');
  }
  const { value, problems } = checkAnnouncement(data, { today, groups: rows.groups });
  if (!value) throw new AppError('invalid', { fields: problems });
  const written = rows.announcements.filter((r) => r.authorId === user.id && r.createdAt.slice(0, 10) === today).length;
  if (written >= ANNOUNCE.perDay) throw new AppError('too_many');
  const row = store.insert('announcements', { ...value, authorId: user.id, createdAt: localDateTime(now), removedBy: '', removedAt: '' });
  return { item: itemOf(rows, row, user, today) };
}

export function removeAnnouncement(store, platform, data, user) {
  const rows = readRows(store);
  const row = typeof data.id === 'string' ? rows.announcements.find((r) => r.id === data.id) : undefined;
  if (!row) throw new AppError('not_found');
  if (row.authorId !== user.id && !isOffice(user)) throw new AppError('forbidden');
  if (row.removedAt !== '') return {};
  store.update('announcements', row.id, { removedBy: user.id, removedAt: localDateTime(platform.now()) });
  return {};
}
