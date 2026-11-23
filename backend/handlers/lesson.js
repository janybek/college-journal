import { checkinCurrent, checkinMark, checkinPass } from '../checkinData.js';
import { endCheckin, finishLesson, getLesson, lessonMine, startLesson } from '../lessonData.js';

export const lessonHandlers = {
  'lesson.mine': (data, ctx, user) => lessonMine(ctx.store, ctx.platform, user),
  'lesson.get': (data, ctx, user) => getLesson(ctx.store, ctx.platform, data, user),
  'lesson.start': (data, ctx, user) => startLesson(ctx.store, ctx.platform, data, user),
  'lesson.endCheckin': (data, ctx, user) => endCheckin(ctx.store, ctx.platform, data, user),
  'lesson.finish': (data, ctx, user) => finishLesson(ctx.store, ctx.platform, data, user),
  'checkin.current': (data, ctx, user) => checkinCurrent(ctx.store, ctx.platform, user),
  'checkin.pass': (data, ctx) => checkinPass(ctx.store, ctx.platform, data),
  'checkin.mark': (data, ctx, user) => checkinMark(ctx.store, ctx.platform, data, user),
};
