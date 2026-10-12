/** Drives the real platform UI through the four phases of the XSS challenge. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { preview as startPreview } from 'vite';
import { EXPLOIT_PAYLOAD, initialFiles, traceTargets } from '../shared/challenge.js';

// Serves the static build in dist/ (run `vite build` first; `npm run test:e2e` does both).
const server = await startPreview({ preview: { port: Number(process.env.PORT || 4179), strictPort: true } });
const baseUrl = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4179/';
const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.DOJO_CHROME_PATH || (existsSync(localChrome) ? localChrome : undefined);
const browser = await chromium.launch({ executablePath, headless: !process.env.HEADED });
const screenshots = 'artifacts';
mkdirSync(screenshots, { recursive: true });

const step = (name: string) => console.log(`• ${name}`);
const preview = (page: Page) => page.frameLocator('iframe[title^="Nexo"]');

async function selectFile(page: Page, file: string) {
  await page.locator('.file-tree .file-row', { hasText: file.split('/').pop()! }).click();
  await page.locator(`.code-editor[data-file-path="${file}"]`).waitFor();
}

/** Each completed sub-phase opens a centered dialog that must be acknowledged. */
async function acknowledge(page: Page, title: string) {
  const dialog = page.getByRole('alertdialog', { name: title });
  await dialog.waitFor({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Continuar' }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function markLine(page: Page, kind: keyof typeof traceTargets, button: RegExp) {
  const target = traceTargets[kind];
  await selectFile(page, target.file);
  await page.locator('.cm-lineNumbers .cm-gutterElement').getByText(String(target.line), { exact: true }).click();
  await page.getByRole('button', { name: button }).click();
  await page.locator('.selection-feedback.success').waitFor();
  await acknowledge(page, { sink: 'Ponto vulnerável encontrado', source: 'Entrada encontrada', flow: 'Percurso completo' }[kind]);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => console.error('[page error]', error.message));
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  step('Fase 1: caminho feliz');
  await page.getByRole('button', { name: 'Abrir aplicação' }).click();
  await preview(page).getByTestId('search-input').fill('senha');
  await preview(page).getByTestId('search-button').click();
  await acknowledge(page, 'Busca realizada');
  await preview(page).getByTestId('article').first().click();
  await assert.doesNotReject(preview(page).getByTestId('article-detail').waitFor());
  await page.getByRole('alertdialog', { name: 'Artigo aberto' }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${screenshots}/phase-1.png` });
  await acknowledge(page, 'Artigo aberto');
  await page.locator('.checkpoint.checked').nth(1).waitFor();
  await page.getByRole('button', { name: 'Explorar vulnerabilidade' }).click();

  step('Fase 2: exploração');
  await preview(page).getByTestId('search-input').fill(EXPLOIT_PAYLOAD);
  await preview(page).getByTestId('search-button').click();
  const browserDialog = page.getByRole('alertdialog', { name: 'nexo.local diz' });
  await browserDialog.getByText('XSS', { exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}/phase-2.png` });
  await browserDialog.getByRole('button', { name: 'OK' }).click();
  await acknowledge(page, 'Exploit executado');
  await page.locator('.checkpoint.checked').waitFor();
  await page.getByRole('button', { name: 'Investigar o código' }).click();

  step('Fase 3: sink, source e fluxo');
  await page.locator('.cm-lineNumbers .cm-gutterElement').getByText('1', { exact: true }).click();
  await page.getByRole('button', { name: /Marcar vulnerabilidade/ }).click();
  await page.locator('.selection-feedback.hint').waitFor();
  await markLine(page, 'sink', /Marcar vulnerabilidade/);
  await markLine(page, 'source', /Marcar entrada/);
  await markLine(page, 'flow', /Marcar passagem/);
  await page.locator('.flow-summary').waitFor();
  await page.screenshot({ path: `${screenshots}/phase-3.png` });
  await page.getByRole('button', { name: 'Começar a correção' }).click();

  step('Fase 4: patch incompleto é rejeitado');
  const runAttack = page.getByRole('button', { name: 'Executar ataque automatizado' });
  await runAttack.click();
  await page.getByText('Seu patch ainda precisa de ajustes').waitFor({ timeout: 40_000 });
  await page.locator('.terminal-line.fail', { hasText: 'JavaScript injetado foi executado' }).first().waitFor();

  step('Fase 4: patch com textContent é aprovado');
  await selectFile(page, 'src/render.js');
  const patched = initialFiles['src/render.js'].replace('queryElement.innerHTML = query;', 'queryElement.textContent = query;');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(patched);
  await page.locator('.file-row .modified-dot').waitFor();
  await assert.doesNotReject(runAttack.waitFor());
  await page.waitForFunction(() => !document.querySelector('.spin'));
  await runAttack.click();
  await page.getByText('Patch aprovado. Funcionalidade preservada.').waitFor({ timeout: 40_000 });
  await page.locator('.terminal-line.pass', { hasText: '4/4 verificações passaram' }).waitFor();
  await page.getByRole('alertdialog', { name: 'Desafio concluído' }).waitFor();
  await page.screenshot({ path: `${screenshots}/phase-4-dialog.png` });
  await acknowledge(page, 'Desafio concluído');
  await page.locator('.completion-note').waitFor();
  await page.screenshot({ path: `${screenshots}/phase-4.png` });

  step('Persistência após recarregar');
  await page.reload();
  await page.locator('.completion-note').waitFor();
  console.log(`\nE2E concluído. Capturas em ${screenshots}/`);
} catch (error) {
  console.error('\nE2E falhou:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
  process.exit(process.exitCode ?? 0);
}
