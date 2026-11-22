// Ограничение попыток входа: чистое правило. Время приходит параметром now (мс),
// счёт живёт в замыкании, ничего не читается и не пишется на диск.
export const LOGIN_LIMIT = { attempts: 10, windowMs: 15 * 60000, blockMs: 15 * 60000, maxKeys: 5000, keyLength: 100 };

// Тот же вид логина, что у входа: без пробелов по краям, строчными буквами. Не строка -> ''.
export function loginKey(typed, keyLength = LOGIN_LIMIT.keyLength) {
  return typeof typed === 'string' ? typed.trim().toLowerCase().slice(0, keyLength) : '';
}

export function createLoginGuard(limit = LOGIN_LIMIT) {
  const { attempts, windowMs, blockMs, maxKeys } = limit;
  const table = new Map();   // key -> { first, count, until }

  const closed = (e, now) => e.until !== undefined && now < e.until;
  const stale = (e, now) => (e.until !== undefined ? now >= e.until : now - e.first >= windowMs);

  function dropStale(now) {
    for (const [k, e] of table) if (stale(e, now)) table.delete(k);
  }

  // Освободить место для нового ключа; false — места нет (все записи закрыты).
  function makeRoom(now) {
    if (table.size < maxKeys) return true;
    dropStale(now);
    if (table.size < maxKeys) return true;
    let victim = null;
    for (const [k, e] of table) {
      if (closed(e, now)) continue;
      if (victim === null || e.count < victim.e.count || (e.count === victim.e.count && e.first < victim.e.first)) victim = { k, e };
    }
    if (victim === null) return false;
    table.delete(victim.k);
    return true;
  }

  return {
    blockedFor(key, now) {
      const e = table.get(key);
      if (!e || e.until === undefined) return 0;
      if (now < e.until) return e.until - now;
      table.delete(key);
      return 0;
    },
    fail(key, now) {
      let e = table.get(key);
      if (e && closed(e, now)) return;
      if (e && stale(e, now)) { table.delete(key); e = undefined; }
      if (e) e.count += 1;
      else {
        if (!makeRoom(now)) return;
        e = { first: now, count: 1 };
        table.set(key, e);
      }
      if (e.count >= attempts) e.until = now + blockMs;
    },
    success(key) { table.delete(key); },
    size() { return table.size; },
  };
}
