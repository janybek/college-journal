import { cancelCard, enrol, repeatCandidates, repeatGet, repeatList, saveCard } from '../repeatData.js';

export const repeatHandlers = {
  'repeat.list': (data, ctx, user) => repeatList(ctx.store, ctx.platform, user),
  'repeat.get': (data, ctx, user) => repeatGet(ctx.store, ctx.platform, data, user),
  'repeat.candidates': (data, ctx, user) => repeatCandidates(ctx.store, ctx.platform, data, user),
  'repeat.enrol': (data, ctx, user) => enrol(ctx.store, ctx.platform, data, user),
  'repeat.save': (data, ctx, user) => saveCard(ctx.store, ctx.platform, data, user),
  'repeat.cancel': (data, ctx, user) => cancelCard(ctx.store, ctx.platform, data, user),
};
