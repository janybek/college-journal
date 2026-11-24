import { cancelCard, enrol, repeatCandidates, repeatGet, repeatList, repeatMine, saveCard } from '../repeatData.js';
import { closeRepeat, reopenRepeat, saveAttempt, saveWorks } from '../repeatScores.js';

export const repeatHandlers = {
  'repeat.list': (data, ctx, user) => repeatList(ctx.store, ctx.platform, user),
  'repeat.mine': (data, ctx, user) => repeatMine(ctx.store, ctx.platform, user),
  'repeat.get': (data, ctx, user) => repeatGet(ctx.store, ctx.platform, data, user),
  'repeat.candidates': (data, ctx, user) => repeatCandidates(ctx.store, ctx.platform, data, user),
  'repeat.enrol': (data, ctx, user) => enrol(ctx.store, ctx.platform, data, user),
  'repeat.save': (data, ctx, user) => saveCard(ctx.store, ctx.platform, data, user),
  'repeat.cancel': (data, ctx, user) => cancelCard(ctx.store, ctx.platform, data, user),
  'repeat.saveWorks': (data, ctx, user) => saveWorks(ctx.store, ctx.platform, data, user),
  'repeat.saveAttempt': (data, ctx, user) => saveAttempt(ctx.store, ctx.platform, data, user),
  'repeat.close': (data, ctx, user) => closeRepeat(ctx.store, ctx.platform, data, user),
  'repeat.reopen': (data, ctx, user) => reopenRepeat(ctx.store, ctx.platform, data, user),
};
