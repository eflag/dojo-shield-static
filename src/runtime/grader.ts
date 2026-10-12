/**
 * Automated attack that runs entirely in the browser. Each check loads the compiled app in a fresh,
 * off-screen sandboxed iframe and drives it through the test agent embedded by the compiler.
 *
 * This is a learning aid, not a trustworthy assessment: the student controls both the browser and
 * the code under test, so a determined student can fake results.
 */
import { EXPLOIT_PAYLOAD } from '../../shared/challenge';
import { compileInBrowser } from './compile';

export interface ValidationCheck { id: string; label: string; status: 'passed' | 'failed'; detail: string }
export interface ValidationResult { revision: string; passed: boolean; checks: ValidationCheck[]; durationMs: number }
export type LogLevel = 'command' | 'step' | 'action' | 'pass' | 'fail' | 'info';
export interface ValidationLog { level: LogLevel; text: string; elapsedMs: number }
export type ValidationLogger = (entry: ValidationLog) => void;

type AppState = { articles: string[]; detailVisible: boolean; detailText: string; queryText: string | null; queryElements: number };

const COMMAND_TIMEOUT_MS = 1800;
const LOAD_TIMEOUT_MS = 4000;
const ATTACKS = [
  { id: 'attack-image', label: 'Bloquear XSS com evento de imagem', payload: EXPLOIT_PAYLOAD },
  { id: 'attack-details', label: 'Bloquear XSS com evento de details', payload: `<details open ontoggle="alert('XSS-DETAILS')"><summary>ajuda</summary></details>` },
];
const TOTAL_CHECKS = 2 + ATTACKS.length;
const quoted = (value: string) => JSON.stringify(value);
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

class TimeoutError extends Error {}

/** One disposable copy of the app plus a tiny RPC client for its test agent. */
async function openIsolatedApp(html: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  // Off-screen but rendered, so layout-dependent events (toggle, image errors) behave as in the preview.
  Object.assign(iframe.style, { position: 'fixed', left: '-10000px', top: '0', width: '1024px', height: '768px', border: '0', opacity: '0', pointerEvents: 'none' });
  const alerts: string[] = [];
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let markReady: () => void = () => {};
  const loaded = new Promise<void>((resolve) => { markReady = resolve; });

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.data?.channel !== 'dojo-grader') return;
    const data = event.data;
    if (data.type === 'alert') alerts.push(String(data.message));
    else if (data.type === 'ready') markReady();
    else if (typeof data.id === 'number' && pending.has(data.id)) {
      const request = pending.get(data.id)!;
      pending.delete(data.id);
      if (data.ok) request.resolve(data.result); else request.reject(new Error(String(data.error)));
    }
  };
  window.addEventListener('message', onMessage);
  iframe.srcdoc = html;
  document.body.append(iframe);

  const dispose = () => { window.removeEventListener('message', onMessage); iframe.remove(); };
  const withTimeout = <T,>(promise: Promise<T>, ms: number) => Promise.race([promise, wait(ms).then(() => { throw new TimeoutError(); })]);
  const send = <T,>(cmd: string, args?: object) => {
    const id = nextId++;
    const response = new Promise<T>((resolve, reject) => { pending.set(id, { resolve: resolve as (value: unknown) => void, reject }); });
    iframe.contentWindow?.postMessage({ channel: 'dojo-grader', id, cmd, args }, '*');
    return withTimeout(response, COMMAND_TIMEOUT_MS).finally(() => pending.delete(id));
  };

  try { await withTimeout(loaded, LOAD_TIMEOUT_MS); }
  catch (error) { dispose(); throw error instanceof TimeoutError ? new Error('O navegador não abriu o aplicativo do desafio.') : error; }

  return {
    alerts,
    dispose,
    search: async (query: string) => { await send('search', { query }); await wait(30); },
    clickArticle: async (index: number) => { await send('clickArticle', { index }); await wait(30); },
    state: () => send<AppState>('state'),
  };
}

function explainFailure(error: unknown): string {
  if (error instanceof TimeoutError) return 'A aplicação não respondeu a tempo. Confira se a busca e seus controles continuam funcionando.';
  return error instanceof Error ? error.message.split('\n')[0].slice(0, 260) : 'A verificação não pôde ser concluída.';
}

export async function validateChallenge(files: Record<string, string>, onLog: ValidationLogger = () => {}): Promise<ValidationResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const log = (level: LogLevel, text: string) => onLog({ level, text, elapsedMs: elapsed() });
  log('step', 'Compilando o projeto com esbuild (somente módulos do desafio)');
  const compiled = await compileInBrowser(files, 'grader');
  log('pass', `Bundle gerado · revisão ${compiled.revision}`);
  const checks: ValidationCheck[] = [];

  const run = async (id: string, label: string, test: (app: Awaited<ReturnType<typeof openIsolatedApp>>) => Promise<string>) => {
    let app: Awaited<ReturnType<typeof openIsolatedApp>> | undefined;
    log('step', `[${checks.length + 1}/${TOTAL_CHECKS}] ${label}`);
    try {
      app = await openIsolatedApp(compiled.html);
      const detail = await test(app);
      checks.push({ id, label, status: 'passed', detail });
      log('pass', detail);
    } catch (error) {
      const detail = explainFailure(error);
      checks.push({ id, label, status: 'failed', detail });
      log('fail', detail);
    } finally { app?.dispose(); }
  };
  const search = async (app: Awaited<ReturnType<typeof openIsolatedApp>>, query: string) => {
    log('action', query ? `buscar ${quoted(query)}` : 'buscar com o campo vazio');
    await app.search(query);
    return app.state();
  };

  await run('functional-search', 'Buscar e abrir um artigo', async (app) => {
    let state = await search(app, 'senha');
    log('info', `${state.articles.length} resultado(s): ${state.articles.map((title) => quoted(title.trim())).join(', ') || 'nenhum'}`);
    if (state.articles.length !== 1 || !state.articles[0].includes('Como redefinir sua senha')) throw new Error('A busca por “senha” deve retornar o artigo correto.');
    log('action', 'abrir o primeiro artigo');
    await app.clickArticle(0);
    state = await app.state();
    if (!state.detailVisible || !state.detailText.includes('Redefinir senha')) throw new Error('O artigo precisa abrir e apresentar suas instruções.');
    log('info', 'detalhe do artigo visível com as instruções');
    state = await search(app, 'EQUIPE');
    if (state.articles.length !== 1 || !state.articles[0].includes('Convidar pessoas')) throw new Error('A busca deve continuar ignorando maiúsculas e minúsculas.');
    log('info', 'maiúsculas ignoradas: "Convidar pessoas para sua equipe"');
    state = await search(app, '');
    log('info', `${state.articles.length} artigos listados`);
    if (state.articles.length !== 4) throw new Error('A busca vazia deve mostrar os quatro artigos.');
    return 'Busca, abertura de artigos, maiúsculas e busca vazia preservadas.';
  });

  await run('functional-text', 'Preservar o texto da consulta', async (app) => {
    for (const query of ['senha', '<b>equipe</b>', 'conta & acesso "pessoal"']) {
      const state = await search(app, query);
      log('info', `exibido: ${quoted(state.queryText ?? '')}`);
      if (state.queryText !== query) throw new Error(`A consulta precisa aparecer como texto literal: ${query}`);
      if (state.queryElements !== 0) throw new Error('A consulta foi interpretada como marcação HTML.');
    }
    return 'Caracteres especiais e marcação aparecem como texto, sem alterar o conteúdo.';
  });

  for (const attack of ATTACKS) {
    await run(attack.id, attack.label, async (app) => {
      log('action', `injetar payload ${attack.payload}`);
      await app.search(attack.payload);
      // Event handlers run asynchronously after insertion into the real browser DOM.
      await wait(250);
      if (app.alerts.length) throw new Error(`JavaScript injetado foi executado: alert(${JSON.stringify(app.alerts[0])}).`);
      log('info', 'nenhuma chamada a alert() observada');
      const state = await app.state();
      if (state.queryText !== attack.payload) throw new Error('O ataque não executou, mas a consulta não foi preservada como texto.');
      if (state.queryElements) throw new Error('A consulta ainda introduz elementos HTML na página.');
      log('info', 'payload exibido como texto literal, sem elementos HTML');
      return 'Nenhuma execução observada; a entrada foi preservada como texto literal.';
    });
  }

  const passed = checks.filter((check) => check.status === 'passed').length;
  log(passed === checks.length ? 'pass' : 'fail', `${passed}/${checks.length} verificações passaram em ${(elapsed() / 1000).toFixed(1)}s`);
  return { revision: compiled.revision, passed: passed === checks.length, checks, durationMs: elapsed() };
}
