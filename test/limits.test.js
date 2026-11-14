'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter, CompileQueue } = require('../lib/limits');

test('rate limiter allows N per window, then asks to wait', () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(rl.take('a').ok, true);
  assert.equal(rl.take('a').ok, true);
  const third = rl.take('a');
  assert.equal(third.ok, false);
  assert.ok(third.retryAfter >= 1);
  assert.equal(rl.take('b').ok, true, 'other visitors are unaffected');
  clearInterval(rl.sweeper);
});

test('compile queue limits concurrency and rejects when the line is full', async () => {
  const q = new CompileQueue({ concurrency: 1, maxWaiting: 1 });
  let release;
  const first = q.run(() => new Promise((r) => { release = r; }));
  const second = q.run(async () => 'second');
  await assert.rejects(q.run(async () => 'third'), (e) => e.busy === true);
  release('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
});
