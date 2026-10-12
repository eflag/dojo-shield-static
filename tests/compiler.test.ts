import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { initialFiles } from '../shared/challenge.js';
import { compileChallenge as compile } from '../shared/compiler.js';

// The browser uses esbuild-wasm; Node tests exercise the same compiler with native esbuild.
const compileChallenge = (files: unknown, mode?: 'preview' | 'grader') => compile(files, build as Parameters<typeof compile>[1], mode);
const repaired = () => ({ ...initialFiles, 'src/render.js': initialFiles['src/render.js'].replace('queryElement.innerHTML = query;', 'queryElement.textContent = query;') });

test('compiler loads only permitted in-memory modules and leaves a stable revision', async () => {
  const first = await compileChallenge(initialFiles);
  const reordered = Object.fromEntries(Object.entries(initialFiles).reverse());
  assert.equal(first.revision, (await compileChallenge(reordered)).revision);
  assert.notEqual(first.revision, (await compileChallenge(repaired())).revision);
  assert.match(first.html, /Content-Security-Policy/);
  assert.match(first.html, /connect-src 'none'/);
  await assert.rejects(compileChallenge({ ...initialFiles, 'src/main.js': "import fs from 'node:fs';" }), /Import externo/);
  await assert.rejects(compileChallenge({ ...initialFiles, 'src/main.js': "import '../../private.js';" }), /fora dos arquivos/);
  await assert.rejects(compileChallenge({ ...initialFiles, 'src/main.js': "import('https://example.com/module.js');" }), /Imports dinâmicos/);
  await assert.rejects(compileChallenge({ ...initialFiles, 'index.html': '<p>changed</p>' }), /somente leitura/);
  await assert.rejects(compileChallenge({ ...initialFiles, 'src/render.js': 'export function renderSearch( {' }), /src\/render\.js:1/);
});

test('compiler prevents a script terminator from escaping the inline bundle', async () => {
  const result = await compileChallenge({ ...initialFiles, 'src/main.js': `document.body.dataset.example = '</script><script>alert(123)</script>';` });
  assert.equal((result.html.match(/<\/script>/g) || []).length, 2);
  assert.doesNotMatch(result.html, /<\/script><script>alert\(123\)/);
});

test('preview and grader builds embed different instrumentation for the same revision', async () => {
  const preview = await compileChallenge(initialFiles, 'preview');
  const grader = await compileChallenge(initialFiles, 'grader');
  assert.equal(preview.revision, grader.revision);
  assert.match(preview.html, /channel: 'dojo-preview'/);
  assert.doesNotMatch(preview.html, /dojo-grader/);
  assert.match(grader.html, /writable: false/);
  assert.match(grader.html, /channel: 'dojo-grader'/);
});
