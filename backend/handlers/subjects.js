import { addSubjects, subjectsOverview } from '../subjectData.js';

export const subjectHandlers = {
  'subjects.add': (data, ctx) => addSubjects(ctx.store, data),
  'subjects.overview': (data, ctx, user) => subjectsOverview(ctx.store, user),
};
