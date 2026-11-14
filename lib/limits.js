'use strict';

// Protects the server when it is public:
//  - RateLimiter: at most N compiles per visitor per minute (sliding window).
//  - CompileQueue: at most K compiles running at once; a few more may wait in line.

class RateLimiter {
  constructor({ limit, windowMs = 60_000 }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map(); // key -> timestamps
    // Forget idle visitors so memory stays bounded.
    this.sweeper = setInterval(() => this.sweep(), windowMs).unref();
  }

  /** @returns {{ ok: true } | { ok: false, retryAfter: number }} */
  take(key) {
    if (!this.limit) return { ok: true };
    const now = Date.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { ok: false, retryAfter: Math.ceil((recent[0] + this.windowMs - now) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true };
  }

  sweep() {
    const now = Date.now();
    for (const [key, times] of this.hits) {
      if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}

class CompileQueue {
  constructor({ concurrency, maxWaiting }) {
    this.concurrency = Math.max(1, concurrency);
    this.maxWaiting = maxWaiting;
    this.running = 0;
    this.waiting = [];
  }

  get size() { return this.running + this.waiting.length; }

  /** Runs fn when a slot is free. Rejects with { busy: true } if the line is full. */
  run(fn) {
    if (this.running >= this.concurrency && this.waiting.length >= this.maxWaiting) {
      return Promise.reject(Object.assign(new Error('busy'), { busy: true }));
    }
    return new Promise((resolve, reject) => {
      const start = async () => {
        this.running++;
        try { resolve(await fn()); } catch (err) { reject(err); } finally {
          this.running--;
          const next = this.waiting.shift();
          if (next) next();
        }
      };
      if (this.running < this.concurrency) start();
      else this.waiting.push(start);
    });
  }
}

module.exports = { RateLimiter, CompileQueue };
