import { endCheckin, finishLesson, getLesson, lessonMine, startLesson } from '../lessonData.js';

export const lessonHandlers = {
  'lesson.mine': (data, ctx, user) => lessonMine(ctx.store, ctx.platform, user),
  'lesson.get': (data, ctx, user) => getLesson(ctx.store, ctx.platform, data, user),
  'lesson.start': (data, ctx, user) => startLesson(ctx.store, ctx.platform, data, user),
  'lesson.endCheckin': (data, ctx, user) => endCheckin(ctx.store, ctx.platform, data, user),
  'lesson.finish': (data, ctx, user) => finishLesson(ctx.store, ctx.platform, data, user),
};
