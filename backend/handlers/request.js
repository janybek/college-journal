import { createRequest, decideRequest, myRequests, requestQueue, withdrawRequest } from '../requestData.js';

export const requestHandlers = {
  'request.create': (data, ctx, user) => createRequest(ctx.store, ctx.platform, data, user),
  'request.mine': (data, ctx, user) => myRequests(ctx.store, ctx.platform, user),
  'request.queue': (data, ctx, user) => requestQueue(ctx.store, ctx.platform, user),
  'request.decide': (data, ctx, user) => decideRequest(ctx.store, ctx.platform, data, user),
  'request.withdraw': (data, ctx, user) => withdrawRequest(ctx.store, ctx.platform, data, user),
};
