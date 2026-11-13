import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProject, STARTER_FILES, stripCommonRoot, detectMain, validatePath } from '../public/js/project.js';

const project = (obj) => new Map(Object.entries(obj).map(([p, text]) => [p, { text }]));

test('the starter project has no warnings (\\verb examples are ignored)', () => {
  assert.deepEqual(checkProject(project(STARTER_FILES), 'main.tex'), []);
});

test('missing .bib file is reported at the \\bibliography line', () => {
  const files = project({ 'main.tex': '\\documentclass{article}\n\\begin{document}\n\\cite{a}\n\\bibliography{references}\n\\end{document}' });
  const [w] = checkProject(files, 'main.tex');
  assert.match(w.message, /references\.bib/);
  assert.equal(w.line, 4);
});

test('citation keys missing from the .bib file are listed', () => {
  const files = project({
    'main.tex': '\\cite{knuth, owaspcrs}\n% \\cite{commented}\n\\bibliography{refs}',
    'refs.bib': '@book{knuth, title={x}}\n@string{foo = "bar"}',
  });
  const [w] = checkProject(files, 'main.tex');
  assert.match(w.message, /1 citation is not in refs\.bib: owaspcrs/);
});

test('missing images and \\input files are found relative to the main file', () => {
  const files = project({
    'paper/main.tex': '\\input{chapters/intro}\n\\includegraphics{figs/plot}\n\\input{chapters/missing}',
    'paper/chapters/intro.tex': 'hi',
  });
  files.set('paper/figs/plot.png', { blob: {} });
  const msgs = checkProject(files, 'paper/main.tex').map((w) => w.message);
  assert.deepEqual(msgs, ['File "chapters/missing.tex" is not in the project.']);
});

test('folder helpers', () => {
  assert.deepEqual(stripCommonRoot([{ path: 'proj/a.tex' }, { path: 'proj/b/c.png' }]).entries.map((e) => e.path), ['a.tex', 'b/c.png']);
  assert.equal(detectMain(project({ 'x.tex': 'no class', 'paper/main.tex': '\\documentclass{article}' })), 'paper/main.tex');
  assert.equal(validatePath('../x.tex') !== null, true);
  assert.equal(validatePath('chapters/intro.tex'), null);
});
