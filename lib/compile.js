'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ENGINES = ['pdflatex', 'xelatex', 'lualatex'];

const config = {
  backend: (process.env.TEX_BACKEND || 'auto').toLowerCase(), // auto | local | remote
  remoteUrl: process.env.TEX_REMOTE_URL || 'https://texlive.net/cgi-bin/latexcgi',
  timeoutMs: Number(process.env.TEX_TIMEOUT_MS) || 60000,
};

/** Result: { ok: true, pdf: Buffer, backend } or { ok: false, log: string, backend, reason? } */

// ---------- local TeX installation ----------

const availability = new Map();
function hasLocalEngine(engine) {
  if (!availability.has(engine)) {
    availability.set(engine, new Promise((resolve) => {
      const p = spawn(engine, ['--version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    }));
  }
  return availability.get(engine);
}

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      // Restrict file access to the working directory and disable shell escape.
      env: { ...process.env, openin_any: 'p', openout_any: 'p', shell_escape: 'f' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { if (out.length < 2e6) out += d; });
    child.stderr.on('data', (d) => { if (out.length < 2e6) out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: String(err), timedOut: false }); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut: signal === 'SIGKILL' });
    });
  });
}

async function compileLocal(source, engine) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'texc-'));
  try {
    await fs.writeFile(path.join(dir, 'document.tex'), source, 'utf8');
    const args = ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'document.tex'];
    const deadline = Date.now() + config.timeoutMs;
    let log = '';

    // Up to two passes so tables of contents and \ref labels resolve.
    for (let pass = 0; pass < 2; pass++) {
      const r = await run(engine, args, dir, Math.max(1000, deadline - Date.now()));
      log = await fs.readFile(path.join(dir, 'document.log'), 'utf8').catch(() => r.out);
      if (r.timedOut) return { ok: false, log, reason: `Compilation took longer than ${config.timeoutMs / 1000}s and was stopped.` };
      if (r.code !== 0) return { ok: false, log };
      if (!/Rerun to get|Label\(s\) may have changed/.test(log)) break;
    }

    const pdf = await fs.readFile(path.join(dir, 'document.pdf')).catch(() => null);
    if (!pdf) return { ok: false, log, reason: 'TeX finished but did not produce a PDF.' };
    return { ok: true, pdf };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- remote service (texlive.net by default) ----------

async function compileRemote(source, engine) {
  const form = new FormData();
  form.append('filecontents[]', source);
  form.append('filename[]', 'document.tex');
  form.append('engine', engine);
  form.append('return', 'pdf');

  let res;
  try {
    // The service answers with a redirect to either document.pdf or document.log.
    res = await fetch(config.remoteUrl, {
      method: 'POST',
      body: form,
      redirect: 'follow',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      log: '',
      unavailable: true,
      reason: timedOut
        ? `The compilation service did not answer within ${config.timeoutMs / 1000}s.`
        : `Could not reach the compilation service (${err.cause?.code || err.message}).`,
    };
  }

  const body = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    return { ok: false, log: '', unavailable: true, reason: `The compilation service returned HTTP ${res.status}.` };
  }
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return { ok: true, pdf: body };
  return { ok: false, log: body.toString('utf8') };
}

// ---------- entry point ----------

async function describeBackend(engine) {
  if (config.backend === 'remote') return 'remote';
  if (config.backend === 'local') return 'local';
  return (await hasLocalEngine(engine)) ? 'local' : 'remote';
}

async function compile(source, engine = 'pdflatex') {
  if (!ENGINES.includes(engine)) throw new Error(`Unsupported engine "${engine}".`);
  const backend = await describeBackend(engine);

  if (backend === 'local') {
    if (!(await hasLocalEngine(engine))) {
      return {
        ok: false, backend, log: '', unavailable: true,
        reason: `TEX_BACKEND=local but "${engine}" was not found on this server. Install TeX Live or set TEX_BACKEND=remote.`,
      };
    }
    return { ...(await compileLocal(source, engine)), backend };
  }
  return { ...(await compileRemote(source, engine)), backend };
}

module.exports = { compile, describeBackend, config, ENGINES };
