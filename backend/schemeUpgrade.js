// Moves a saved scoring scheme to regulation 2.9 at the start of a server: the "good" threshold 76 becomes 80,
// the three rows of the semester / exam split are added. Nothing is written when there is nothing to move.
import { upgradeScheme } from '../core/scoring.js';

export function applySchemeUpgrade(store) {
  const { updates, inserts } = upgradeScheme(store.list('settings'));
  if (updates.length === 0 && inserts.length === 0) return { moved: [] };
  const run = () => {
    if (updates.length > 0) store.updateMany('settings', updates);
    if (inserts.length > 0) store.insertMany('settings', inserts);
  };
  if (typeof store.transaction === 'function') store.transaction(run);
  else run();
  return { moved: [...(updates.length > 0 ? ['scoreGood'] : []), ...inserts.map((r) => r.key)] };
}
