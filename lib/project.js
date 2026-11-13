'use strict';

// Validates and normalizes a project sent by the browser:
//   { files: [{ path, content } | { path, base64 }], main: 'main.tex' }

const MAX_FILES = 300;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

class ProjectError extends Error {}

function cleanPath(p) {
  if (typeof p !== 'string') throw new ProjectError('A file is missing its name.');
  const path = p.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/{2,}/g, '/');
  if (!path || path.startsWith('/') || path.split('/').some((s) => s === '..' || s === '.' || s === '')
    || /[\0-\x1f"*?<>|:]/.test(path) || path.length > 240) {
    throw new ProjectError(`"${p}" is not a valid file name.`);
  }
  return path;
}

/** @returns {{ files: Array<{path:string, data:Buffer, text:string|null}>, main: string }} */
function normalizeProject(payload) {
  // Backwards compatible single-file form: { source }
  if (typeof payload.source === 'string' && !payload.files) {
    payload = { files: [{ path: 'main.tex', content: payload.source }], main: 'main.tex' };
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0) throw new ProjectError('The project has no files.');
  if (payload.files.length > MAX_FILES) throw new ProjectError(`Projects can have at most ${MAX_FILES} files.`);

  const seen = new Set();
  let total = 0;
  const files = payload.files.map((f) => {
    const path = cleanPath(f && f.path);
    if (seen.has(path)) throw new ProjectError(`"${path}" appears twice.`);
    seen.add(path);
    let data;
    let text = null;
    if (typeof f.content === 'string') {
      text = f.content;
      data = Buffer.from(text, 'utf8');
    } else if (typeof f.base64 === 'string') {
      data = Buffer.from(f.base64, 'base64');
    } else {
      throw new ProjectError(`"${path}" has no content.`);
    }
    total += data.length;
    return { path, data, text };
  });
  if (total > MAX_TOTAL_BYTES) throw new ProjectError('The project is too large (limit 25 MB).');

  const main = cleanPath(payload.main || 'main.tex');
  const mainFile = files.find((f) => f.path === main);
  if (!mainFile) throw new ProjectError(`The main file "${main}" is not in the project.`);
  if (mainFile.text === null || !/\.(tex|ltx)$/i.test(main)) throw new ProjectError('The main file must be a .tex file.');
  if (!mainFile.text.trim()) throw new ProjectError(`The main file "${main}" is empty. Write some LaTeX first.`);

  return { files, main };
}

/**
 * TeX resolves paths relative to the main file's folder, so re-root the project there.
 * Files outside that folder are not reachable by TeX and are dropped.
 */
function rootAtMain(project) {
  const slash = project.main.lastIndexOf('/');
  if (slash === -1) return { ...project, prefix: '' };
  const prefix = project.main.slice(0, slash + 1);
  return {
    prefix,
    main: project.main.slice(slash + 1),
    files: project.files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) })),
  };
}

module.exports = { normalizeProject, rootAtMain, ProjectError, MAX_TOTAL_BYTES };
