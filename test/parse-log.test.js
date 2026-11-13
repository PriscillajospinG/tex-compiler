'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLog } = require('../lib/parse-log');

test('undefined control sequence reports line, context and hint', () => {
  const log = [
    '(./main.tex',
    'LaTeX Font Info:    ... okay on input line 2.',
    '! Undefined control sequence.',
    'l.3 Hi \\foo',
    '           ',
    '! Emergency stop.',
    'l.3 ',
    '!  ==> Fatal error occurred, no output PDF file produced!',
  ].join('\n');
  const errors = parseLog(log, { main: 'main.tex' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Undefined control sequence.');
  assert.equal(errors[0].file, 'main.tex');
  assert.equal(errors[0].line, 3);
  assert.equal(errors[0].context, 'Hi \\foo');
  assert.match(errors[0].hint, /misspelled/);
});

test('file:line:error format reports the right file in a subfolder', () => {
  const log = [
    './chapters/intro.tex:3: Undefined control sequence.',
    'l.3 Second \\badcmd',
    "./chapters/intro.tex:3:  ==> Fatal error occurred, no output PDF file produced!",
  ].join('\n');
  const [e, ...rest] = parseLog(log, { main: 'main.tex' });
  assert.equal(rest.length, 0);
  assert.equal(e.file, 'chapters/intro.tex');
  assert.equal(e.line, 3);
  assert.equal(e.context, 'Second \\badcmd');
});

test('compiler-side main file names map back to the project main file', () => {
  const log = './__main_document__.tex:6: Undefined control sequence.\nl.6 See \\foo';
  const [e] = parseLog(log, { main: 'paper.tex' });
  assert.equal(e.file, 'paper.tex');
});

test('missing package is located at the \\usepackage line', () => {
  const log = [
    "! LaTeX Error: File `nopkgxyz.sty' not found.",
    '',
    '! Emergency stop.',
    '<read *> ',
    'l.3 \\begin',
  ].join('\n');
  const files = { 'main.tex': '\\documentclass{article}\n\\usepackage{nopkgxyz}\n\\begin{document}\nHi\n\\end{document}\n' };
  const [e] = parseLog(log, { main: 'main.tex', files });
  assert.equal(e.file, 'main.tex');
  assert.equal(e.line, 2);
});

test('mismatched environment', () => {
  const log = [
    '! LaTeX Error: \\begin{itemize} on input line 5 ended by \\end{document}.',
    '',
    'See the LaTeX manual or LaTeX Companion for explanation.',
    'l.9 \\end{document}',
  ].join('\n');
  const [e] = parseLog(log);
  assert.equal(e.line, 9);
  assert.match(e.hint, /matching/);
});

test('BibTeX: missing .bib file and missing citation keys', () => {
  const log = [
    'This is BibTeX, Version 0.99e (TeX Live 2026)',
    'The top-level auxiliary file: document.aux',
    'The style file: elsarticle-num.bst',
    "I couldn't open database file references.bib",
    '---line 282 of file document.aux',
    ' : \\bibdata{references',
    ' :                    }',
    "I'm skipping whatever remains of this command",
    'I found no database files---while reading file document.aux',
    'Warning--I didn\'t find a database entry for "owaspcrs"',
    'Warning--I didn\'t find a database entry for "vaswani2017attention"',
    '(There were 2 error messages)',
  ].join('\n');
  const files = { 'main.tex': '\\documentclass{elsarticle}\n\\begin{document}\n\\bibliography{references}\n\\end{document}\n' };
  const errors = parseLog(log, { main: 'main.tex', files });
  const missing = errors.find((e) => /references\.bib/.test(e.message));
  assert.ok(missing, 'reports the missing .bib file');
  assert.equal(missing.severity, 'error');
  assert.equal(missing.file, 'main.tex');
  assert.equal(missing.line, 3);
  assert.match(missing.hint, /bibliography file/i);
  const keys = errors.find((e) => e.severity === 'warning');
  assert.match(keys.message, /2 citations not found.*owaspcrs, vaswani2017attention/);
});

test('BibTeX syntax error in a .bib file', () => {
  const log = "I was expecting a `,' or a `}'---line 3 of file references.bib\n :   title={x}\n";
  const [e] = parseLog(log, { main: 'main.tex' });
  assert.equal(e.file, 'references.bib');
  assert.equal(e.line, 3);
  assert.match(e.message, /I was expecting/);
});

test('empty log gives no errors', () => {
  assert.deepEqual(parseLog(''), []);
});
