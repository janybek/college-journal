import { disciplineDoc, documentsBoard } from '../documentsData.js';

export const docsHandlers = {
  'docs.syllabi': (data, ctx, user) => documentsBoard(ctx.store, ctx.platform, user),
  'docs.discipline': (data, ctx, user) => disciplineDoc(ctx.store, ctx.platform, data, user),
};
