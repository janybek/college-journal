import { uploadSyllabus } from '../syllabusData.js';

export const syllabusHandlers = {
  'syllabus.preview': (data, ctx) => uploadSyllabus(ctx.store, ctx.platform, data, false),
  'syllabus.apply': (data, ctx) => uploadSyllabus(ctx.store, ctx.platform, data, true),
};
