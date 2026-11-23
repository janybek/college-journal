import { AppError } from '../../core/errors.js';
import { readWorkRows, removeAssignment, saveAssignment, staffWorkView, workList, workOverview } from '../workData.js';
import { studentWorkView, submitWork, workMine } from '../workStudent.js';
import { gradeWork } from '../workGrade.js';
import { dropFile, readFile, uploadFile } from '../workFiles.js';

// 'work.get': the staff reads the whole group, the student only his own work.
function getWork(ctx, data, user) {
  const rows = readWorkRows(ctx.store);
  const assignment = typeof data.assignmentId === 'string' ? rows.assignments.find((a) => a.id === data.assignmentId) : undefined;
  if (!assignment) throw new AppError('not_found');
  if (user.kind === 'student') return studentWorkView(rows, ctx.platform, assignment, user);
  return staffWorkView(rows, ctx.platform, assignment, user);
}

export const workHandlers = {
  'work.overview': (data, ctx, user) => workOverview(ctx.store, ctx.platform, user),
  'work.list': (data, ctx, user) => workList(ctx.store, ctx.platform, data, user),
  'work.save': (data, ctx, user) => saveAssignment(ctx.store, ctx.platform, data, user),
  'work.remove': (data, ctx, user) => removeAssignment(ctx.store, ctx.platform, data, user),
  'work.get': (data, ctx, user) => getWork(ctx, data, user),
  'work.grade': (data, ctx, user) => gradeWork(ctx.store, ctx.platform, data, user),
  'work.mine': (data, ctx, user) => workMine(ctx.store, ctx.platform, user),
  'work.upload': (data, ctx, user) => uploadFile(ctx.store, ctx.platform, ctx.files, data, user),
  'work.dropFile': (data, ctx, user) => dropFile(ctx.store, ctx.platform, ctx.files, data, user),
  'work.submit': (data, ctx, user) => submitWork(ctx.store, ctx.platform, data, user),
  'work.file': (data, ctx, user) => readFile(ctx.store, ctx.platform, ctx.files, data, user),
};
