import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSession, clearSession } from '../site/js/session.js';
import { reviewCount, setReviewCount, refreshReviewCount } from '../site/js/reviewCount.js';

// The site's request module reads the address of the page; the stand's answers on /api.
globalThis.location = { hostname: 'localhost' };

const DEAN = { id: 'sf_1', permissions: ['subjects.overview', 'syllabus.queue'] };
const TEACHER = { id: 'sf_2', permissions: ['teacher.mySubjects', 'syllabus.submit'] };

// A stand-in for fetch that counts the requests and answers syllabus.queue with `count`.
function fakeFetch(count) {
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return { json: async () => ({ ok: true, data: { count } }) };
  };
  return sent;
}

test('refreshReviewCount: without the right to the queue no request leaves (a teacher who sent a version)', async () => {
  setSession({ token: 'tok-teacher', user: TEACHER });
  const sent = fakeFetch(5);
  await refreshReviewCount();
  assert.deepEqual(sent, []);
  assert.equal(reviewCount(), null);
  clearSession();
  await refreshReviewCount();
  assert.deepEqual(sent, []);
});

test('refreshReviewCount: with the right, one light request; its number is kept', async () => {
  setSession({ token: 'tok-dean', user: DEAN });
  const sent = fakeFetch(3);
  await refreshReviewCount();
  assert.deepEqual(sent.map(({ action, data }) => ({ action, data })), [{ action: 'syllabus.queue', data: { countOnly: true } }]);
  assert.equal(reviewCount(), 3);
});

test('reviewCount: the number belongs to the session it was read in; another sign-in does not see it', () => {
  setSession({ token: 'tok-a', user: DEAN });
  setReviewCount(2);
  assert.equal(reviewCount(), 2);
  setSession({ token: 'tok-b', user: DEAN });
  assert.equal(reviewCount(), null);
  setReviewCount(-1);
  setReviewCount(1.5);
  assert.equal(reviewCount(), null);
  clearSession();
  assert.equal(reviewCount(), null);
});
