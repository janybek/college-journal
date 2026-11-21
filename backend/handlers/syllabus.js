import { studentSubjects, syllabusPage, uploadSyllabus } from '../syllabusData.js';

export const syllabusHandlers = {
  'syllabus.preview': (data, ctx) => uploadSyllabus(ctx.store, ctx.platform, data, false),
  'syllabus.apply': (data, ctx) => uploadSyllabus(ctx.store, ctx.platform, data, true),
  'syllabus.get': (data, ctx, user) => syllabusPage(ctx.store, ctx.platform, data, user),
  'student.subjects': (data, ctx, user) => studentSubjects(ctx.store, user),
};
