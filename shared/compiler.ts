/**
 * Compiles the student's three modules into one self-contained HTML document.
 * Runs in the browser (esbuild-wasm) and in Node tests (esbuild); the caller injects `build`.
 */
import type { BuildOptions, BuildResult, Plugin } from 'esbuild';
import { challengeCss, challengeHtml, editableFiles, initialFiles } from './challenge';

export class CompilationError extends Error {}
export interface CompiledChallenge { html: string; revision: string }
type Build = (options: BuildOptions & { write: false }) => Promise<BuildResult & { outputFiles: { text: string }[] }>;
/** `preview` talks to the platform; `grader` embeds the test agent used by the automated attack. */
export type CompileMode = 'preview' | 'grader';

export function normalizeFiles(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CompilationError('Envie um objeto com os arquivos do desafio.');
  }
  const supplied = input as Record<string, unknown>;
  const files = { ...initialFiles };
  let total = 0;
  for (const [name, source] of Object.entries(supplied)) {
    if (!Object.hasOwn(initialFiles, name)) throw new CompilationError(`Arquivo não permitido: ${name}`);
    if (typeof source !== 'string' || source.length > 50_000) throw new CompilationError(`Conteúdo inválido ou muito grande: ${name}`);
    total += source.length;
    if (total > 160_000) throw new CompilationError('O projeto excede o limite deste desafio.');
    if (!editableFiles.includes(name) && source !== initialFiles[name]) throw new CompilationError(`Este arquivo é somente leitura: ${name}`);
    files[name] = source;
  }
  for (const name of editableFiles) {
    if (typeof supplied[name] !== 'string') throw new CompilationError(`Arquivo obrigatório ausente: ${name}`);
    // This introductory exercise supports only static local module imports.
    if (/\bimport\s*\(/.test(files[name])) throw new CompilationError('Imports dinâmicos não estão disponíveis neste desafio.');
  }
  return files;
}

export async function revisionFor(files: Record<string, string>): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', payload));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Resolves `./x.js` / `../x.js` against the importer, POSIX style, without node:path. */
function resolveRelative(importer: string, specifier: string): string {
  const parts = importer.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}

const previewInstrumentation = `(() => {
  // The platform draws a browser-style dialog for this call; the app itself stays unchanged.
  window.alert = function (message) {
    window.parent.postMessage({ channel: 'dojo-preview', type: 'exploit', message: String(message) }, '*');
  };
  // Learning progress only: lets the platform know an article was opened during the happy path.
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-testid="article"]')) {
      window.parent.postMessage({ channel: 'dojo-preview', type: 'article' }, '*');
    }
  }, true);
})();`;

/**
 * Test agent for the automated attack. It runs before the app, locks alert so the app cannot
 * replace it, and executes driver commands sent by the platform through postMessage.
 */
const graderAgent = `(() => {
  const reply = (data) => window.parent.postMessage(Object.assign({ channel: 'dojo-grader' }, data), '*');
  Object.defineProperty(window, 'alert', { configurable: false, writable: false, value: function (message) { reply({ type: 'alert', message: String(message) }); } });
  const byTestId = (id) => document.querySelector('[data-testid="' + id + '"]');
  const required = (id) => { const element = byTestId(id); if (!element) throw new Error('Elemento não encontrado: ' + id); return element; };
  const commands = {
    search(args) { const input = required('search-input'); input.value = args.query; required('search-button').click(); },
    clickArticle(args) { const items = document.querySelectorAll('[data-testid="article"]'); if (!items[args.index]) throw new Error('Artigo não encontrado.'); items[args.index].click(); },
    state() {
      const query = byTestId('query');
      const detail = byTestId('article-detail');
      return {
        articles: Array.from(document.querySelectorAll('[data-testid="article"]'), (item) => item.textContent || ''),
        detailVisible: !!detail && !detail.hidden && detail.getClientRects().length > 0,
        detailText: detail ? detail.textContent || '' : '',
        queryText: query ? query.textContent : null,
        queryElements: query ? query.querySelectorAll('*').length : 0,
      };
    },
  };
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.channel !== 'dojo-grader' || !commands[data.cmd]) return;
    try { reply({ id: data.id, ok: true, result: commands[data.cmd](data.args || {}) }); }
    catch (error) { reply({ id: data.id, ok: false, error: error && error.message ? String(error.message) : 'Falha no comando.' }); }
  });
  window.addEventListener('load', () => setTimeout(() => reply({ type: 'ready' }), 0));
})();`;

export async function compileChallenge(input: unknown, build: Build, mode: CompileMode = 'preview'): Promise<CompiledChallenge> {
  const files = normalizeFiles(input);
  const plugin: Plugin = {
    name: 'challenge-memory-only',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return { path: 'src/main.js', namespace: 'challenge' };
        if (!args.path.startsWith('./') && !args.path.startsWith('../')) {
          return { errors: [{ text: `Import externo não permitido: ${args.path}` }] };
        }
        const resolved = resolveRelative(args.importer, args.path);
        if (!editableFiles.includes(resolved)) return { errors: [{ text: `Import fora dos arquivos do desafio: ${args.path}` }] };
        return { path: resolved, namespace: 'challenge' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'challenge' }, (args) => ({ contents: files[args.path], loader: 'js' }));
    },
  };
  try {
    const output = await build({
      entryPoints: ['src/main.js'],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      sourcemap: false,
      legalComments: 'none',
      logLevel: 'silent',
      plugins: [plugin],
    });
    // An inline script must never let student text close the script element.
    const script = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const policy = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'`;
    const instrumentation = mode === 'grader' ? graderAgent : previewInstrumentation;
    const html = challengeHtml
      .replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="${policy}" />`)
      .replace('<link rel="stylesheet" href="./styles.css" />', `<style>${challengeCss}</style>`)
      .replace('<script type="module" src="./src/main.js"></script>', () => `<script>${instrumentation}</script><script>${script}</script>`);
    return { html, revision: await revisionFor(files) };
  } catch (error) {
    if (error instanceof CompilationError) throw error;
    const failure = error as { errors?: Array<{ text: string; location?: { file: string; line: number } | null }> };
    const first = failure.errors?.[0];
    throw new CompilationError(first ? `${first.location ? `${first.location.file}:${first.location.line}: ` : ''}${first.text}` : 'Não foi possível compilar o projeto.');
  }
}
