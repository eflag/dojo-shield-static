# Dojo Shield (estático)

Laboratório de desenvolvimento seguro inspirado no [OWASP Dojo Shield](https://owasp.org/www-project-dojo-shield/).
O primeiro desafio, **Busca sob controle**, ensina DOM XSS em quatro etapas:

1. **Conhecer:** usar a aplicação Nexo pelo caminho feliz.
2. **Explorar:** executar um payload XSS no navegador simulado.
3. **Investigar:** marcar no código o ponto vulnerável (sink), a entrada (source) e a passagem do dado.
4. **Corrigir:** editar o código e rodar o ataque automatizado, que exige bloquear o XSS sem quebrar a busca.

Tudo roda no navegador, sem backend, e pode ser publicado no GitHub Pages.

## Como funciona

- **Compilação:** os três módulos do desafio são empacotados no navegador com
  [esbuild-wasm](https://esbuild.github.io/getting-started/#wasm), carregado sob demanda. Só imports
  relativos entre os arquivos do desafio são aceitos.
- **Preview:** o app compilado roda em um `iframe` com `sandbox="allow-scripts"` (origem opaca) e uma CSP
  que bloqueia rede, frames, workers e recursos externos. Chamadas a `alert()` viram um diálogo no estilo
  do navegador desenhado pela plataforma.
- **Ataque automatizado:** cada verificação abre uma cópia descartável do app em um iframe sandbox fora
  da tela. Um agente de teste injetado antes do código do app trava `window.alert`, executa buscas e
  cliques enviados por `postMessage` e devolve o estado da página. O log é exibido no terminal em ritmo
  de leitura.
- **Progresso:** salvo no `localStorage` do navegador.

### Limites

Isto é um recurso de aprendizado, não uma avaliação confiável. Como o estudante controla o navegador e o
código testado, é possível burlar o resultado (por exemplo, imitando as respostas do agente de teste). Para
certificar competências seria necessário um avaliador isolado no servidor.

## Desenvolvimento

```bash
npm install
npm run dev        # http://127.0.0.1:4173
npm test           # testes do compilador (Node + esbuild)
npm run test:e2e   # build estático + fluxo completo das 4 etapas no Chromium (Playwright)
npm run build      # gera dist/
```

O e2e usa o Google Chrome local quando existe, `DOJO_CHROME_PATH` quando definido, ou o Chromium do
Playwright (`npx playwright install chromium`). Use `HEADED=1` para ver o navegador.

## Deploy no GitHub Pages

O workflow `.github/workflows/deploy.yml` roda os testes, gera o build com `BASE_PATH=/<repositório>/` e
publica `dist/` no Pages a cada push na `main`. No repositório, em **Settings > Pages**, selecione
**Source: GitHub Actions**.
