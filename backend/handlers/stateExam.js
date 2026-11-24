import { removeStateExam, saveStateExam, saveStateExamScores, stateExamGet, stateExamList } from '../stateExamData.js';

export const stateExamHandlers = {
  'stateExam.list': (data, ctx, user) => stateExamList(ctx.store, ctx.platform, user),
  'stateExam.get': (data, ctx, user) => stateExamGet(ctx.store, ctx.platform, data, user),
  'stateExam.save': (data, ctx, user) => saveStateExam(ctx.store, ctx.platform, data, user),
  'stateExam.saveScores': (data, ctx, user) => saveStateExamScores(ctx.store, ctx.platform, data, user),
  'stateExam.remove': (data, ctx, user) => removeStateExam(ctx.store, ctx.platform, data, user),
};
