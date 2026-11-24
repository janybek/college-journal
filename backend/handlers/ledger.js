import { addAttempt, saveExam } from '../examData.js';
import { closeFinal, closeUnit, ledgerList, ledgerView, readLedgerRows, reopenUnit } from '../ledgerData.js';

export const ledgerHandlers = {
  'ledger.list': (data, ctx, user) => ledgerList(ctx.store, ctx.platform, user),
  'ledger.get': (data, ctx, user) => ({ ledger: ledgerView(readLedgerRows(ctx.store, ctx.platform), ctx.platform, data.subjectId, user) }),
  'ledger.closeUnit': (data, ctx, user) => closeUnit(ctx.store, ctx.platform, data, user),
  'ledger.closeFinal': (data, ctx, user) => closeFinal(ctx.store, ctx.platform, data, user),
  'ledger.reopen': (data, ctx, user) => reopenUnit(ctx.store, ctx.platform, data, user),
  'ledger.saveExam': (data, ctx, user) => saveExam(ctx.store, ctx.platform, data, user),
  'ledger.addAttempt': (data, ctx, user) => addAttempt(ctx.store, ctx.platform, data, user),
};
