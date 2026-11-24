import { changeLogView, journalList, journalView, missPair, readSettledRows, reopenPair, saveUnitResults, savePairMarks } from '../journalData.js';
import { studentGrades } from '../studentGrades.js';

export const journalHandlers = {
  'journal.get': (data, ctx, user) => ({ journal: journalView(readSettledRows(ctx.store, ctx.platform), ctx.platform, data.subjectId, user) }),
  'journal.list': (data, ctx, user) => journalList(readSettledRows(ctx.store, ctx.platform), ctx.platform, user),
  'journal.savePair': (data, ctx, user) => savePairMarks(ctx.store, ctx.platform, data, user),
  'journal.saveResults': (data, ctx, user) => saveUnitResults(ctx.store, ctx.platform, data, user),
  'journal.missPair': (data, ctx, user) => missPair(ctx.store, ctx.platform, data, user),
  'journal.reopenPair': (data, ctx, user) => reopenPair(ctx.store, ctx.platform, data, user),
  'student.grades': (data, ctx, user) => studentGrades({ ...readSettledRows(ctx.store, ctx.platform), examAttempts: ctx.store.list('examAttempts') }, ctx.platform, user),
  'journal.log': (data, ctx, user) => changeLogView(ctx.store, ctx.platform, data, user),
};
