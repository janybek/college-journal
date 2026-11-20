import { AppError } from '../../core/errors.js';
import { generateSchedule } from '../scheduleData.js';

const MANAGER_ROLES = ['admin', 'dean', 'prorector'];

function generate(data, ctx) {
  return generateSchedule(ctx.store, ctx.platform, { dryRun: data.dryRun === true, restart: data.restart === true });
}

// Topics of one subject in order, each with the pair it stands on.
function plan(data, ctx, user) {
  const { store } = ctx;
  const subject = typeof data.subjectId === 'string' ? store.get('subjects', data.subjectId) : null;
  if (!subject) throw new AppError('not_found');
  if (!user.roles.some((r) => MANAGER_ROLES.includes(r)) && subject.teacherId !== user.id) throw new AppError('forbidden');

  const group = store.get('groups', subject.groupId);
  const teacher = store.get('staff', subject.teacherId);
  const pairs = store.list('pairs').filter((p) => p.subjectId === subject.id);
  const byTopic = new Map(pairs.filter((p) => p.topicId !== '').map((p) => [p.topicId, p]));
  const topics = store.list('topics')
    .filter((t) => t.subjectId === subject.id)
    .sort((a, b) => a.order - b.order)
    .map((t) => {
      const p = byTopic.get(t.id);
      return {
        id: t.id, unit: t.unit, order: t.order, name: t.name, lessonType: t.lessonType,
        pair: p ? { id: p.id, date: p.date, slot: p.slot, startTime: p.startTime, status: p.status } : null,
      };
    });
  return {
    subject: {
      id: subject.id, name: subject.name, groupId: subject.groupId, groupName: group ? group.name : '',
      teacherId: subject.teacherId, teacherName: teacher ? teacher.fullName : '',
    },
    topics,
    withoutTopic: pairs.filter((p) => p.status === 'planned' && p.topicId === '').length,
  };
}

export const scheduleHandlers = {
  'schedule.generate': generate,
  'topics.plan': plan,
};
