import { studentSubjects, syllabusPage, uploadSyllabus } from '../syllabusData.js';
import { draftForm, saveSection, startDraft } from '../syllabusDraft.js';
import { approveSyllabus, returnSyllabus, reviewQueue, submitSyllabus } from '../syllabusFlow.js';

export const syllabusHandlers = {
  'syllabus.preview': (data, ctx) => uploadSyllabus(ctx.store, ctx.platform, data, false),
  'syllabus.apply': (data, ctx) => uploadSyllabus(ctx.store, ctx.platform, data, true),
  'syllabus.get': (data, ctx, user) => syllabusPage(ctx.store, ctx.platform, data, user),
  'syllabus.startDraft': (data, ctx, user) => startDraft(ctx.store, ctx.platform, data, user),
  'syllabus.form': (data, ctx, user) => draftForm(ctx.store, ctx.platform, data, user),
  'syllabus.saveSection': (data, ctx, user) => saveSection(ctx.store, ctx.platform, data, user),
  'syllabus.submit': (data, ctx, user) => submitSyllabus(ctx.store, ctx.platform, data, user),
  'syllabus.approve': (data, ctx, user) => approveSyllabus(ctx.store, ctx.platform, data, user),
  'syllabus.return': (data, ctx, user) => returnSyllabus(ctx.store, ctx.platform, data, user),
  'syllabus.queue': (data, ctx) => reviewQueue(ctx.store, ctx.platform, data),
  'student.subjects': (data, ctx, user) => studentSubjects(ctx.store, user),
};
