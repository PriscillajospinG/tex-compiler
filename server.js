'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { compile, describeBackend, config, ENGINES } = require('./lib/compile');
const { parseLog } = require('./lib/parse-log');
const { normalizeProject, ProjectError } = require('./lib/project');
const { RateLimiter, CompileQueue } = require('./lib/limits');

// ---------------------------------------------------------------------------
// Configuration (all optional; see README)
// ---------------------------------------------------------------------------
const env = process.env;
const PORT = Number(env.PORT) || 3000;
// Containers and hosting platforms need 0.0.0.0; local development stays private by default.
const HOST = env.HOST || (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const TRUST_PROXY = /^(1|true|yes)$/i.test(env.TRUST_PROXY || '');
const RATE_LIMIT = env.COMPILE_RATE_LIMIT === undefined ? 30 : Number(env.COMPILE_RATE_LIMIT); // per visitor per minute, 0 = off
const MAX_CONCURRENT = Number(env.MAX_CONCURRENT_COMPILES) || 2;
const MAX_QUEUE = env.MAX_QUEUED_COMPILES === undefined ? 8 : Number(env.MAX_QUEUED_COMPILES);
const MAX_BODY_BYTES = 40 * 1024 * 1024; // 25 MB of files, base64-encoded
const PUBLIC_DIR = path.join(__dirname, 'public');

const limiter = new RateLimiter({ limit: RATE_LIMIT });
const queue = new CompileQueue({ concurrency: MAX_CONCURRENT, maxWaiting: MAX_QUEUE });

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  'frame-src blob:',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(req) {
  const headers = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (isHttps(req)) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function isHttps(req) {
  if (req.socket.encrypted) return true;
  return TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function clientKey(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...res.baseHeaders, ...headers });
  res.end(body);
}

function sendJson(res, status, data, extra = {}) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }, JSON.stringify(data));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) {
      reject(Object.assign(new Error('too large'), { status: 413 }));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// POST /api/compile
// ---------------------------------------------------------------------------
async function handleCompile(req, res) {
  const allowed = limiter.take(clientKey(req));
  if (!allowed.ok) {
    req.resume();
    return sendJson(res, 429, {
      ok: false, errors: [],
      reason: `You're compiling very quickly. Please wait ${allowed.retryAfter} seconds and try again.`,
    }, { 'Retry-After': String(allowed.retryAfter) });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch (err) {
    if (err.status === 413) return sendJson(res, 413, { ok: false, reason: 'The project is too large (limit 25 MB).', errors: [] });
    return sendJson(res, 400, { ok: false, reason: 'The request was not valid JSON.', errors: [] });
  }

  let project;
  try {
    project = normalizeProject(payload || {});
  } catch (err) {
    if (err instanceof ProjectError) return sendJson(res, 400, { ok: false, reason: err.message, errors: [] });
    throw err;
  }
  const engine = ENGINES.includes(payload.engine) ? payload.engine : 'pdflatex';

  const started = Date.now();
  let result;
  try {
    result = await queue.run(() => compile(project, engine));
  } catch (err) {
    if (err.busy) {
      return sendJson(res, 503, {
        ok: false, errors: [],
        reason: 'The server is busy compiling other documents. Please try again in a few seconds.',
      }, { 'Retry-After': '5' });
    }
    console.error('[compile] unexpected error:', err);
    return sendJson(res, 500, { ok: false, reason: 'The server hit an unexpected problem while compiling.', errors: [] });
  }
  const ms = Date.now() - started;
  const bytes = project.files.reduce((n, f) => n + f.data.length, 0);
  console.log(`[compile] ${result.ok ? 'ok  ' : 'fail'} ${engine} ${(ms / 1000).toFixed(1)}s ${project.files.length} files ${(bytes / 1024).toFixed(0)}KB via ${result.service || result.backend}`);

  if (result.ok) {
    return send(res, 200, {
      'Content-Type': 'application/pdf',
      'Content-Length': result.pdf.length,
      'Cache-Control': 'no-store',
      'X-Compile-Backend': result.backend,
      'X-Compile-Service': result.service || '',
      ...(result.note ? { 'X-Compile-Note': encodeURIComponent(result.note) } : {}),
      'X-Compile-Ms': String(ms),
    }, result.pdf);
  }

  const textFiles = Object.fromEntries(project.files.filter((f) => f.text !== null).map((f) => [f.path, f.text]));
  const prefix = project.main.includes('/') ? project.main.slice(0, project.main.lastIndexOf('/') + 1) : '';
  const errors = parseLog(result.log, { main: project.main, files: textFiles })
    .map((e) => (e.file && prefix && !textFiles[e.file] && textFiles[prefix + e.file] ? { ...e, file: prefix + e.file } : e));
  // 422: the LaTeX itself has a problem. 502: the compiler could not be reached.
  sendJson(res, result.unavailable ? 502 : 422, {
    ok: false,
    backend: result.backend,
    service: result.service || null,
    ms,
    reason: result.reason || (errors.length ? null : 'Compilation failed, but the compiler did not report a specific error. See the full log below.'),
    errors,
    log: result.log ? result.log.slice(-20000) : '',
  });
}

// ---------------------------------------------------------------------------
// Static files: ETag, gzip/brotli, sensible caching
// ---------------------------------------------------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg)/;
const fileCache = new Map(); // absolute path -> { mtimeMs, size, etag, raw, gzip, br }

async function loadStatic(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
  const cached = fileCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
  const raw = await fs.readFile(file);
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const entry = {
    mtimeMs: stat.mtimeMs, size: stat.size, type, raw,
    etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"`,
  };
  if (COMPRESSIBLE.test(type) && raw.length > 1024) {
    entry.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
    entry.gzip = zlib.gzipSync(raw, { level: 9 });
  }
  fileCache.set(file, entry);
  return entry;
}

async function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  }
  if (urlPath.includes('\0')) return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || path.basename(file).startsWith('.')) {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  }

  let entry;
  try {
    entry = await loadStatic(file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR') {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    throw err;
  }

  // Third-party libraries live under a versioned path, so they can be cached for a long time.
  // Everything else is revalidated with the ETag on each visit, so deploys show up immediately.
  const cacheControl = urlPath.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  const headers = { 'Content-Type': entry.type, 'Cache-Control': cacheControl, ETag: entry.etag, Vary: 'Accept-Encoding' };

  if (req.headers['if-none-match'] === entry.etag) return send(res, 304, headers);

  const accept = String(req.headers['accept-encoding'] || '');
  let body = entry.raw;
  if (entry.br && /\bbr\b/.test(accept)) { body = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (entry.gzip && /\bgzip\b/.test(accept)) { body = entry.gzip; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  send(res, 200, headers, req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  res.baseHeaders = securityHeaders(req);
  const pathname = (req.url || '/').split('?')[0];
  try {
    if (pathname === '/api/compile') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, reason: 'Use POST.' }, { Allow: 'POST' });
      return await handleCompile(req, res);
    }
    if (pathname === '/healthz' || pathname === '/api/status') {
      return sendJson(res, 200, {
        ok: true,
        backend: await describeBackend('pdflatex'),
        engines: ENGINES,
        compiling: queue.running,
        waiting: queue.waiting.length,
      });
    }
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res);
    sendJson(res, 405, { ok: false, reason: 'Method not allowed' }, { Allow: 'GET, HEAD, POST' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, reason: 'Internal error' });
    else res.destroy();
  }
});

// Timeouts suited to running behind a load balancer.
server.requestTimeout = config.timeoutMs + 30_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000;

if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    const backend = await describeBackend('pdflatex');
    console.log(`TeX Compiler running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(backend === 'local'
      ? 'Compiler: local TeX installation (documents stay on this server)'
      : `Compiler: online service ${config.remoteUrl} (install TeX or use the Docker image to compile locally)`);
    console.log(`Limits: ${RATE_LIMIT || 'unlimited'} compiles/min per visitor, ${MAX_CONCURRENT} at once, ${MAX_QUEUE} waiting${TRUST_PROXY ? ', trusting X-Forwarded-For' : ''}`);
  });

  // Finish in-flight compiles before exiting (hosting platforms send SIGTERM on deploy).
  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, finishing ${queue.size} compile(s) and shutting down…`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 30_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = server;
