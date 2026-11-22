import { journalList, journalView, readJournalRows, savePairMarks } from '../journalData.js';

export const journalHandlers = {
  'journal.get': (data, ctx, user) => ({ journal: journalView(readJournalRows(ctx.store), ctx.platform, data.subjectId, user) }),
  'journal.list': (data, ctx, user) => journalList(readJournalRows(ctx.store), ctx.platform, user),
  'journal.savePair': (data, ctx, user) => savePairMarks(ctx.store, ctx.platform, data, user),
};
