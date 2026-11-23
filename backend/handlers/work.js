import { AppError } from '../../core/errors.js';
import { readWorkRows, removeAssignment, saveAssignment, staffWorkView, workList, workOverview } from '../workData.js';

// 'work.get': the staff reads here; the student's own view comes with the student's tasks.
function getWork(ctx, data, user) {
  if (user.kind === 'student') throw new AppError('not_found');
  const rows = readWorkRows(ctx.store);
  const assignment = typeof data.assignmentId === 'string' ? rows.assignments.find((a) => a.id === data.assignmentId) : undefined;
  if (!assignment) throw new AppError('not_found');
  return staffWorkView(rows, ctx.platform, assignment, user);
}

export const workHandlers = {
  'work.overview': (data, ctx, user) => workOverview(ctx.store, ctx.platform, user),
  'work.list': (data, ctx, user) => workList(ctx.store, ctx.platform, data, user),
  'work.save': (data, ctx, user) => saveAssignment(ctx.store, ctx.platform, data, user),
  'work.remove': (data, ctx, user) => removeAssignment(ctx.store, ctx.platform, data, user),
  'work.get': (data, ctx, user) => getWork(ctx, data, user),
};
