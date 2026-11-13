'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { compile, describeBackend, config, ENGINES } = require('./lib/compile');
const { parseLog } = require('./lib/parse-log');
const { normalizeProject, ProjectError } = require('./lib/project');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY_BYTES = 40 * 1024 * 1024; // 25 MB of files, base64-encoded
const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
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

async function handleCompile(req, res) {
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
    result = await compile(project, engine);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { ok: false, reason: 'The server hit an unexpected problem while compiling.' });
  }
  const ms = Date.now() - started;

  if (result.ok) {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': result.pdf.length,
      'Cache-Control': 'no-store',
      'X-Compile-Backend': result.backend,
      'X-Compile-Ms': String(ms),
    });
    return res.end(result.pdf);
  }

  const textFiles = Object.fromEntries(project.files.filter((f) => f.text !== null).map((f) => [f.path, f.text]));
  const prefix = project.main.includes('/') ? project.main.slice(0, project.main.lastIndexOf('/') + 1) : '';
  const errors = parseLog(result.log, { main: project.main, files: textFiles })
    .map((e) => (e.file && prefix && !textFiles[e.file] && textFiles[prefix + e.file] ? { ...e, file: prefix + e.file } : e));
  // 422: the LaTeX itself has a problem. 502: the compiler could not be reached.
  sendJson(res, result.unavailable ? 502 : 422, {
    ok: false,
    backend: result.backend,
    ms,
    reason: result.reason || (errors.length ? null : 'Compilation failed, but the compiler did not report a specific error. See the full log below.'),
    errors,
    log: result.log ? result.log.slice(-20000) : '',
  });
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { ok: false });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/compile' && req.method === 'POST') return await handleCompile(req, res);
    if (req.url === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, { backend: await describeBackend('pdflatex'), engines: ENGINES, remoteUrl: config.remoteUrl });
    }
    if (req.method === 'GET') return await serveStatic(req, res);
    sendJson(res, 405, { ok: false, reason: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, reason: 'Internal error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    const backend = await describeBackend('pdflatex');
    console.log(`TeX Compiler running at http://${HOST}:${PORT}`);
    console.log(backend === 'local'
      ? 'Compiler: local TeX installation'
      : `Compiler: remote service ${config.remoteUrl}`);
  });
}

module.exports = server;
