'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { rootAtMain } = require('./project');

const ENGINES = ['pdflatex', 'xelatex', 'lualatex'];

const config = {
  backend: (process.env.TEX_BACKEND || 'auto').toLowerCase(), // auto | local | remote
  remoteUrl: process.env.TEX_REMOTE_URL || 'https://latex.ytotech.com/builds/sync',
  timeoutMs: Number(process.env.TEX_TIMEOUT_MS) || 90000,
};

/**
 * Result:
 *   { ok: true, pdf: Buffer }
 *   { ok: false, log: string, reason?: string, unavailable?: boolean }
 */

// ---------- local TeX installation ----------

const availability = new Map();
function hasCommand(cmd) {
  if (!availability.has(cmd)) {
    availability.set(cmd, new Promise((resolve) => {
      const p = spawn(cmd, ['--version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    }));
  }
  return availability.get(cmd);
}

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      // Restrict file access to the project folder and disable shell escape.
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

const readText = (file) => fs.readFile(file, 'utf8').catch(() => '');

async function compileLocal(project, engine) {
  const { files, main } = rootAtMain(project);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'texc-'));
  const stem = main.replace(/\.[^.]+$/, '');
  const deadline = Date.now() + config.timeoutMs;
  const timeLeft = () => Math.max(1000, deadline - Date.now());
  const timeoutResult = (log) => ({ ok: false, log, reason: `Compilation took longer than ${config.timeoutMs / 1000}s and was stopped.` });

  try {
    for (const f of files) {
      const target = path.join(dir, f.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, f.data);
    }

    const texArgs = ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-no-shell-escape', main];
    const runTex = async () => {
      const r = await run(engine, texArgs, dir, timeLeft());
      const log = (await readText(path.join(dir, `${stem}.log`))) || r.out;
      return { ...r, log };
    };

    let r = await runTex();
    if (r.timedOut) return timeoutResult(r.log);
    if (r.code !== 0) return { ok: false, log: r.log };

    // Bibliography: biblatex/biber writes a .bcf file, classic BibTeX puts \bibdata in the .aux file.
    const aux = await readText(path.join(dir, `${stem}.aux`));
    const hasBcf = await fs.access(path.join(dir, `${stem}.bcf`)).then(() => true, () => false);
    let bib = null;
    if (hasBcf) bib = { cmd: 'biber', logFile: `${stem}.blg` };
    else if (/\\bibdata\{/.test(aux)) bib = { cmd: 'bibtex', logFile: `${stem}.blg` };

    if (bib) {
      if (!(await hasCommand(bib.cmd))) {
        return { ok: false, log: '', reason: `This document needs ${bib.cmd}, which is not installed on the server.` };
      }
      const b = await run(bib.cmd, [stem], dir, timeLeft());
      const blg = (await readText(path.join(dir, bib.logFile))) || b.out;
      if (b.timedOut) return timeoutResult(blg);
      // BibTeX exits 1 for warnings and 2 for errors; biber exits non-zero on errors.
      if ((bib.cmd === 'bibtex' && b.code >= 2) || (bib.cmd === 'biber' && b.code !== 0)) return { ok: false, log: blg };
    }

    // Re-run so citations, \ref labels and the table of contents resolve
    // (twice after a bibliography run, otherwise only when TeX asks for it; at most 3 extra passes).
    const RERUN = /Rerun to get|Label\(s\) may have changed|Please rerun LaTeX/;
    for (let pass = 1; pass <= 3; pass++) {
      const needed = (bib && pass <= 2) || RERUN.test(r.log);
      if (!needed) break;
      r = await runTex();
      if (r.timedOut) return timeoutResult(r.log);
      if (r.code !== 0) return { ok: false, log: r.log };
    }

    const pdf = await fs.readFile(path.join(dir, `${stem}.pdf`)).catch(() => null);
    if (!pdf) return { ok: false, log: r.log, reason: 'TeX finished but did not produce a PDF.' };
    return { ok: true, pdf };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- remote service (LaTeX-on-HTTP, latex.ytotech.com by default) ----------

async function compileRemote(project, engine) {
  const { files, main } = rootAtMain(project);
  const body = {
    compiler: engine,
    options: {
      compiler: { halt_on_error: true },
      response: { log_files_on_failure: true },
    },
    resources: files.map((f) => {
      if (f.path === main) return { main: true, content: f.text };
      return f.text !== null ? { path: f.path, content: f.text } : { path: f.path, file: f.data.toString('base64') };
    }),
  };

  let res;
  try {
    res = await fetch(config.remoteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/pdf, application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false, log: '', unavailable: true,
      reason: timedOut
        ? `The compilation service did not answer within ${config.timeoutMs / 1000}s.`
        : `Could not reach the compilation service (${err.cause?.code || err.message}). Check your internet connection.`,
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (res.ok && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ok: true, pdf: buf };

  let data = null;
  try { data = JSON.parse(buf.toString('utf8')); } catch { /* not JSON */ }

  if (data && data.error === 'COMPILATION_ERROR') {
    const logs = Object.entries(data.log_files || {})
      .sort(([a], [b]) => (a.endsWith('.log') ? -1 : 0) - (b.endsWith('.log') ? -1 : 0))
      .map(([name, text]) => (Object.keys(data.log_files).length > 1 ? `===== ${name} =====\n${text}` : text));
    if (typeof data.logs === 'string' && data.logs.trim()) logs.push(`===== compiler output =====\n${data.logs}`);
    return { ok: false, log: logs.join('\n\n') };
  }

  const detail = data && (data.error || data.message);
  return {
    ok: false, log: '', unavailable: true,
    reason: `The compilation service returned an error (HTTP ${res.status}${detail ? `: ${detail}` : ''}).`,
  };
}

// ---------- entry point ----------

async function describeBackend(engine = 'pdflatex') {
  if (config.backend === 'remote') return 'remote';
  if (config.backend === 'local') return 'local';
  return (await hasCommand(engine)) ? 'local' : 'remote';
}

async function compile(project, engine = 'pdflatex') {
  if (!ENGINES.includes(engine)) throw new Error(`Unsupported engine "${engine}".`);
  const backend = await describeBackend(engine);

  if (backend === 'local') {
    if (!(await hasCommand(engine))) {
      return {
        ok: false, backend, log: '', unavailable: true,
        reason: `TEX_BACKEND=local but "${engine}" was not found on this server. Install TeX Live or set TEX_BACKEND=remote.`,
      };
    }
    return { ...(await compileLocal(project, engine)), backend };
  }
  return { ...(await compileRemote(project, engine)), backend };
}

module.exports = { compile, describeBackend, config, ENGINES };
