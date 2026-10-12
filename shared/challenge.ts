/** The small, self-contained application presented to the student. */
const main = `import { searchArticles } from './search.js';

const input = document.querySelector('[data-testid="search-input"]');
const button = document.querySelector('[data-testid="search-button"]');

function handleSearch() {
  const query = input.value;
  searchArticles(query);
  window.parent.postMessage({ channel: 'dojo-preview', type: 'search', query }, '*');
}

button.addEventListener('click', handleSearch);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSearch();
});

searchArticles('');
`;

const search = `import { renderSearch } from './render.js';

const articles = [
  { title: 'Como redefinir sua senha', category: 'Sua conta', body: 'Abra as configurações da sua conta, escolha Segurança e selecione Redefinir senha. Confirme a nova senha para salvar.' },
  { title: 'Atualizar os dados da sua conta', category: 'Sua conta', body: 'No menu da sua conta, abra Perfil. Você pode atualizar seu nome e endereço de e-mail e salvar as alterações.' },
  { title: 'Convidar pessoas para sua equipe', category: 'Equipe', body: 'Abra Equipe e selecione Convidar pessoa. Informe o e-mail e escolha a função antes de enviar o convite.' },
  { title: 'Consultar faturas e pagamentos', category: 'Pagamentos', body: 'Você encontra o histórico de faturas em Configurações, na seção Pagamentos. Cada fatura pode ser consultada individualmente.' },
];

export function searchArticles(query) {
  const term = query.toLocaleLowerCase('pt-BR').trim();
  const matches = articles.filter((article) =>
    article.title.toLocaleLowerCase('pt-BR').includes(term)
  );
  renderSearch(query, matches);
}
`;

const render = `export function renderSearch(query, articles) {
  const queryElement = document.querySelector('[data-testid="query"]');
  const status = document.querySelector('[data-testid="search-status"]');
  const results = document.querySelector('[data-testid="results"]');
  const detail = document.querySelector('[data-testid="article-detail"]');

  queryElement.innerHTML = query;
  document.querySelector('[data-testid="query-summary"]').hidden = !query;
  status.textContent = query
    ? articles.length + (articles.length === 1 ? ' artigo encontrado' : ' artigos encontrados')
    : 'Artigos populares';
  results.replaceChildren();
  detail.hidden = true;

  for (const article of articles) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'article';
    item.dataset.testid = 'article';
    const category = document.createElement('span');
    category.className = 'article-category';
    category.textContent = article.category;
    const title = document.createElement('span');
    title.className = 'article-title';
    title.textContent = article.title;
    item.append(category, title);
    item.addEventListener('click', () => {
      detail.querySelector('h3').textContent = article.title;
      detail.querySelector('p').textContent = article.body;
      detail.hidden = false;
    });
    results.append(item);
  }

  if (articles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Nenhum artigo por aqui. Tente buscar por senha, conta ou equipe.';
    results.append(empty);
  }
}
`;

export const challengeHtml = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Central de ajuda</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <header class="app-header"><span class="brand">nexo<span class="brand-dot">.</span></span><span class="header-label">Central de ajuda</span></header>
    <main>
      <section class="search-section" aria-labelledby="help-title">
        <span class="eyebrow">Estamos aqui para ajudar</span>
        <h1 id="help-title">Como podemos ajudar?</h1>
        <p class="intro">Encontre respostas e aproveite melhor o seu dia.</p>
        <div class="search-bar" role="search">
          <label class="sr-only" for="article-search">Buscar artigos</label>
          <input id="article-search" data-testid="search-input" type="search" autocomplete="off" placeholder="Busque por senha, conta, equipe…" />
          <button type="button" data-testid="search-button">Buscar</button>
        </div>
        <p class="search-hint">Dica: comece buscando por “senha”</p>
      </section>
      <section class="results-section" aria-label="Artigos de ajuda">
        <p class="results-line" aria-live="polite"><span data-testid="search-status">Artigos populares</span><span class="query-summary" data-testid="query-summary" hidden> para <span data-testid="query"></span></span></p>
        <div class="results" data-testid="results"></div>
        <article class="article-detail" data-testid="article-detail" hidden><span class="eyebrow">Guia rápido</span><h3></h3><p></p></article>
      </section>
      <footer>Respostas simples. Mais tempo para o que importa.</footer>
    </main>
    <script type="module" src="./src/main.js"></script>
  </body>
</html>`;

export const challengeCss = `:root {
  --ink: #221c45;
  --text-secondary: #6c6890;
  --border: #e4e0f5;
  --background: #ffffff;
  --background-subtle: #f5f3ff;
  --accent: #6a4ee6;
  --focus: #8f7bff;
  --heading-h1: 580 clamp(24px, 4.5vw, 32px)/1.2 ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif;
  --heading-h2: 580 16px/1.4 ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif;
  --body: 400 14px/1.55 ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--background); color: var(--ink); font: var(--body); font-optical-sizing: none; }
button, input { font: inherit; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.app-header { height: 68px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px; border-bottom: .5px solid var(--border); }
.brand { font-size: 25px; font-weight: 700; letter-spacing: -1px; }
.brand-dot { color: var(--accent); }
.header-label { color: var(--text-secondary); font-size: 12px; }
main { padding: 40px 32px 0; }
.search-section { background: linear-gradient(160deg, #f3efff 0%, #eef3ff 100%); padding: 32px; border-radius: 16px; text-align: center; }
.eyebrow { font-size: 11px; font-weight: 580; color: var(--accent); letter-spacing: .06em; text-transform: uppercase; }
h1 { font: var(--heading-h1); letter-spacing: -.8px; margin: 12px 0; text-wrap: balance; }
.intro { color: var(--text-secondary); margin: 0 0 24px; }
.search-bar { display: flex; gap: 8px; }
.search-bar input { min-width: 0; width: 100%; height: 44px; border: .5px solid var(--border); border-radius: 10px; padding: 0 14px; background: white; color: var(--ink); }
.search-bar button { border: 0; border-radius: 10px; padding: 0 20px; background: var(--accent); color: white; font-weight: 580; }
.search-bar button:hover { background: #5639cf; }
.search-hint { margin: 12px 0 0; font-size: 12px; color: var(--text-secondary); }
.results-section { margin-top: 32px; }
.results-line { color: var(--text-secondary); font-size: 13px; margin: 0 0 12px; overflow-wrap: anywhere; }
.results { border-top: .5px solid var(--border); }
.article { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; border: 0; border-bottom: .5px solid var(--border); padding: 16px 4px; background: transparent; text-align: left; color: var(--ink); }
.article:hover { background: var(--background-subtle); }
.article-category { font-size: 11px; color: var(--text-secondary); }
.article-title { font-weight: 460; }
.article-detail { margin-top: 24px; padding: 24px; background: var(--background-subtle); border-radius: 12px; }
.article-detail h3 { margin: 8px 0; font: var(--heading-h2); }
.article-detail p { color: var(--text-secondary); margin: 0; }
.empty { color: var(--text-secondary); padding: 16px 0; }
footer { text-align: center; font-size: 11px; color: var(--text-secondary); padding: 32px 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
[hidden] { display: none !important; }
@media (max-width: 520px) { .app-header { padding: 0 20px; } main { padding: 24px 20px 0; } .search-section { padding: 24px 16px; } .search-bar button { padding: 0 14px; } }
`;

export const editableFiles = ['src/main.js', 'src/search.js', 'src/render.js'];
export const initialFiles: Record<string, string> = {
  'index.html': challengeHtml,
  'src/main.js': main,
  'src/search.js': search,
  'src/render.js': render,
  'styles.css': challengeCss,
};

export const EXPLOIT_PAYLOAD = `<img src=x onerror="alert('XSS')">`;

const lineOf = (file: string, text: string) => initialFiles[file].split('\n').findIndex((line) => line.includes(text)) + 1;
export const traceTargets = {
  source: { file: 'src/main.js', line: lineOf('src/main.js', 'const query = input.value;'), explanation: 'O valor do campo de busca entra na aplicação. É uma entrada controlada pela pessoa que usa o app.' },
  flow: { file: 'src/search.js', line: lineOf('src/search.js', 'renderSearch(query, matches);'), explanation: 'A consulta original é repassada à renderização. Normalizar o termo para filtrar artigos não altera o valor exibido.' },
  sink: { file: 'src/render.js', line: lineOf('src/render.js', 'queryElement.innerHTML = query;'), explanation: 'innerHTML interpreta a consulta como HTML. Um manipulador de eventos injetado pode executar JavaScript no contexto da aplicação.' },
};
