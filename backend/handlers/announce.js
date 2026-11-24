import { announceList, removeAnnouncement, saveAnnouncement } from '../announceData.js';

export const announceHandlers = {
  'announce.list': (data, ctx, user) => announceList(ctx.store, ctx.platform, user),
  'announce.save': (data, ctx, user) => saveAnnouncement(ctx.store, ctx.platform, data, user),
  'announce.remove': (data, ctx, user) => removeAnnouncement(ctx.store, ctx.platform, data, user),
};
