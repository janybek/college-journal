// The one "two things in one place" check of the project: the week template, pairs and the server all use it.
// Slot = { id, day, slot, groupId, teacherId, roomId }; day is a weekday 1-5 (template) or a date 'YYYY-MM-DD' (pair).

export function templateSlots(template, subjects) {
  const byId = new Map((subjects || []).map(s => [s.id, s]));
  return (template || []).map(row => {
    const subject = byId.get(row.subjectId);
    return {
      id: row.id, day: row.weekday, slot: row.slot,
      groupId: subject ? subject.groupId : '', teacherId: subject ? subject.teacherId : '', roomId: row.roomId || '',
    };
  });
}

// Cancelled and missed pairs do not occupy a place.
export function pairSlots(pairs) {
  return (pairs || []).filter(p => p.status !== 'cancelled' && p.status !== 'missed').map(p => ({
    id: p.id, day: p.date, slot: p.slot, groupId: p.groupId, teacherId: p.teacherId, roomId: p.roomId,
  }));
}

const CHECKS = [['group_busy', 'groupId'], ['teacher_busy', 'teacherId'], ['room_busy', 'roomId']];

// Subset of ['group_busy', 'teacher_busy', 'room_busy'] (in that order) that `cand` collides with. Empty values never match.
export function busyCodes(slots, cand) {
  const same = (slots || []).filter(s => s.day === cand.day && s.slot === cand.slot && s.id !== cand.id);
  return CHECKS.filter(([, key]) => cand[key] && same.some(s => s[key] === cand[key])).map(([code]) => code);
}
