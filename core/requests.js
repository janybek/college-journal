// Правила заявки на изменение закрытых данных: значения как текст, кто согласует, та же ли цель.
import { ATTENDANCE_STATUSES } from './schema.js';

export const REQUEST = Object.freeze({ openMax: 50, listMax: 200 });

export function markText(mark) {
  if (mark === null || mark === undefined) return '';
  const activity = mark.activity === null || mark.activity === undefined ? '' : String(mark.activity);
  return `${mark.status}|${mark.noCoat ? 1 : 0}|${activity}`;
}

export function parseMarkText(text) {
  if (typeof text !== 'string') return undefined;
  if (text === '') return null;
  const parts = text.split('|');
  if (parts.length !== 3) return undefined;
  const [status, coat, activity] = parts;
  if (!ATTENDANCE_STATUSES.includes(status)) return undefined;
  if (coat !== '0' && coat !== '1') return undefined;
  if (activity !== '' && !/^\d{1,3}$/.test(activity)) return undefined;
  return { status, noCoat: coat === '1', activity: activity === '' ? null : Number(activity) };
}

export function pointsText(value) {
  return value === null || value === undefined ? '' : String(value);
}

export function parsePointsText(text) {
  if (typeof text !== 'string') return undefined;
  if (text === '') return null;
  return /^\d{1,3}$/.test(text) ? Number(text) : undefined;
}

const hasRole = (roles, role) => String(roles).split(',').map((r) => r.trim()).includes(role);

export function mayDecide(request, actor, staff) {
  if (!request || !actor || !Array.isArray(actor.roles) || !Array.isArray(staff)) return false;
  const role = request.status === 'dean' ? 'dean' : request.status === 'prorector' ? 'prorector' : null;
  if (!role) return false;
  const banned = new Set([request.authorId]);
  if (role === 'prorector') banned.add(request.deanBy);
  if (banned.has(actor.id)) return false;
  if (actor.roles.includes(role)) return true;
  if (!actor.roles.includes('admin')) return false;
  return !staff.some((s) => s.active === true && !banned.has(s.id) && hasRole(s.roles, role));
}

export function sameTarget(a, b) {
  return a.kind === b.kind && a.subjectId === b.subjectId
    && (a.planSemester ?? null) === (b.planSemester ?? null) && (a.unit ?? null) === (b.unit ?? null)
    && a.pairId === b.pairId && a.assignmentId === b.assignmentId && a.studentId === b.studentId;
}
