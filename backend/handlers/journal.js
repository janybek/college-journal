import { journalView, readJournalRows } from '../journalData.js';

export const journalHandlers = {
  'journal.get': (data, ctx, user) => ({ journal: journalView(readJournalRows(ctx.store), ctx.platform, data.subjectId, user) }),
};
