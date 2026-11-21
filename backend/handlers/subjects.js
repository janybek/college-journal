import { addSubjects } from '../subjectData.js';

export const subjectHandlers = { 'subjects.add': (data, ctx) => addSubjects(ctx.store, data) };
