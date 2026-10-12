import { useCallback, useEffect, useRef, useState } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Clipboard, FileCode2, FileText, Folder, GraduationCap, Info, LockKeyhole, Maximize2, Minimize2, Monitor, PanelLeftClose, PanelLeftOpen, Play, RefreshCw, RotateCcw, ShieldCheck, Target, Terminal, X, Zap } from 'lucide-react';
import { CodeEditor } from './components/CodeEditor';
import { AttackTerminal, type TerminalLine } from './components/AttackTerminal';
import { MilestoneDialog } from './components/MilestoneDialog';
import { compileInBrowser } from './runtime/compile';
import { validateChallenge, type ValidationLog } from './runtime/grader';
import { initialFiles, editableFiles, EXPLOIT_PAYLOAD, traceTargets } from '../shared/challenge';

type Phase = 1 | 2 | 3 | 4;
type TraceKind = 'source' | 'flow' | 'sink';
type Marks = Partial<Record<TraceKind, boolean>>;
type Report = { revision: string; passed: boolean; checks: { id: string; label: string; status: 'passed' | 'failed'; detail: string }[]; durationMs: number };
type Progress = { files: Record<string, string>; phase: Phase; unlocked: Phase; launched: boolean; happy: boolean; opened: boolean; exploited: boolean; marks: Marks; report: Report | null };
const STORAGE_KEY = 'dojo-shield:workspace:v1';
const steps = [
  { id: 1, name: 'Conheça a aplicação', short: 'Conhecer', subtitle: 'Comece pelo caminho feliz.', icon: Monitor },
  { id: 2, name: 'Explore a vulnerabilidade', short: 'Explorar', subtitle: 'Veja o impacto no navegador.', icon: Zap },
  { id: 3, name: 'Encontre a origem', short: 'Investigar', subtitle: 'Conecte o comportamento ao código.', icon: Target },
  { id: 4, name: 'Corrija e valide', short: 'Corrigir', subtitle: 'Proteja a busca. Preserve a experiência.', icon: ShieldCheck },
] as const;
const milestones = {
  happy: { title: 'Busca realizada', text: 'Você usou a busca como uma pessoa cliente.' },
  opened: { title: 'Artigo aberto', text: 'Caminho feliz conhecido. Agora explore a vulnerabilidade.' },
  exploited: { title: 'Exploit executado', text: 'O JavaScript injetado rodou dentro da aplicação.' },
  sink: { title: 'Ponto vulnerável encontrado', text: 'innerHTML interpreta a consulta como HTML.' },
  source: { title: 'Entrada encontrada', text: 'O valor digitado no campo de busca entra aqui.' },
  flow: { title: 'Percurso completo', text: 'Entrada → passagem → destino. Hora de corrigir.' },
  patched: { title: 'Desafio concluído', text: 'Seu patch bloqueou os ataques e preservou a busca. Explorar → compreender → corrigir.' },
} as const;
type Milestone = keyof typeof milestones;
const happyPathMilestones: Milestone[] = ['happy', 'opened'];
const HAPPY_PATH_DIALOG_DELAY_MS = 2_500;
const milestoneStep: Record<Milestone, string> = { happy: 'CONHECER · 1/2', opened: 'CONHECER · 2/2', exploited: 'EXPLORAR · 1/1', sink: 'INVESTIGAR · 1/3', source: 'INVESTIGAR · 2/3', flow: 'INVESTIGAR · 3/3', patched: 'CORRIGIR · 2/2' };
const TERMINAL_PACE_MS: Record<TerminalLine['level'], number> = { command: 300, step: 700, action: 450, info: 380, pass: 550, fail: 650 };
const MDN = 'https://developer.mozilla.org/pt-BR/docs/Web/API/';
// Several ways to write into the DOM, listed side by side so the answer is not singled out.
const domWriteApis = [
  { name: 'innerHTML', path: 'Element/innerHTML' },
  { name: 'outerHTML', path: 'Element/outerHTML' },
  { name: 'insertAdjacentHTML()', path: 'Element/insertAdjacentHTML' },
  { name: 'innerText', path: 'HTMLElement/innerText' },
  { name: 'textContent', path: 'Node/textContent' },
];
const markNames = { sink: 'Ponto vulnerável', source: 'Entrada · source', flow: 'Passagem do dado' };

function defaultProgress(): Progress {
  return { files: { ...initialFiles }, phase: 1, unlocked: 1, launched: false, happy: false, opened: false, exploited: false, marks: {}, report: null };
}
function loadProgress(): Progress {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || ![1, 2, 3, 4].includes(saved.phase) || ![1, 2, 3, 4].includes(saved.unlocked)) return defaultProgress();
    const files = { ...initialFiles };
    for (const name of editableFiles) if (typeof saved.files?.[name] === 'string' && saved.files[name].length < 100_000) files[name] = saved.files[name];
    return { files, phase: saved.phase, unlocked: saved.unlocked, launched: !!saved.launched || saved.unlocked > 1, happy: !!saved.happy, opened: !!saved.opened, exploited: !!saved.exploited, marks: saved.marks || {}, report: saved.report?.checks instanceof Array ? saved.report : null };
  } catch { return defaultProgress(); }
}

export default function App() {
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const { files, phase, unlocked, launched, happy, opened, exploited, marks, report } = progress;
  const [milestoneQueue, setMilestoneQueue] = useState<Milestone[]>([]);
  const [browserAlert, setBrowserAlert] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [selectedFile, setSelectedFile] = useState('src/main.js');
  const [accordions, setAccordions] = useState(['story', 'files']);
  const [folderOpen, setFolderOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [codeHidden, setCodeHidden] = useState(false);
  const [previewHidden, setPreviewHidden] = useState(false);
  const [preview, setPreview] = useState<{ html: string; revision: string } | null>(null);
  const [buildError, setBuildError] = useState('');
  const [compiling, setCompiling] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [candidate, setCandidate] = useState<{ file: string; line: number } | null>(null);
  const [traceFeedback, setTraceFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const codePanel = useRef<ImperativePanelHandle>(null);
  const previewPanel = useRef<ImperativePanelHandle>(null);
  const latestFiles = useRef(files);
  latestFiles.current = files;
  const traceKind: TraceKind = !marks.sink ? 'sink' : !marks.source ? 'source' : 'flow';
  const traceDone = !!(marks.sink && marks.source && marks.flow);
  const complete = !!report?.passed;
  const codeAvailable = phase >= 3;
  const visibleFiles = phase === 3 ? initialFiles : files;
  const hasPatch = editableFiles.some(name => files[name] !== initialFiles[name]);
  const reached: Record<Milestone, boolean> = { happy, opened, exploited, sink: !!marks.sink, source: !!marks.source, flow: !!marks.flow, patched: complete };
  const subphases: Record<Phase, { label: string; done: boolean }[]> = {
    1: [{ label: 'Buscar', done: happy }, { label: 'Abrir artigo', done: opened }],
    2: [{ label: 'Executar exploit', done: exploited }],
    3: [{ label: 'Ponto vulnerável', done: reached.sink }, { label: 'Entrada', done: reached.source }, { label: 'Passagem', done: reached.flow }],
    4: [{ label: 'Editar código', done: hasPatch || complete }, { label: 'Ataque bloqueado', done: complete }],
  };
  const previouslyReached = useRef(reached);
  const pendingMilestones = useRef<number[]>([]);
  useEffect(() => () => pendingMilestones.current.forEach(clearTimeout), []);
  useEffect(() => {
    const fresh = (Object.keys(milestones) as Milestone[]).filter(key => reached[key] && !previouslyReached.current[key]);
    previouslyReached.current = reached;
    if (!fresh.length) return;
    // Happy-path milestones wait a while so the student can look at the app before the dialog covers it.
    const delayed = fresh.filter(key => happyPathMilestones.includes(key));
    const immediate = fresh.filter(key => !happyPathMilestones.includes(key));
    if (immediate.length) setMilestoneQueue(queue => [...queue, ...immediate]);
    for (const key of delayed) pendingMilestones.current.push(window.setTimeout(() => setMilestoneQueue(queue => [...queue, key]), HAPPY_PATH_DIALOG_DELAY_MS));
  }, [happy, opened, exploited, marks.sink, marks.source, marks.flow, complete]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); setSaveError(false); }
    catch { setSaveError(true); }
  }, [progress]);

  useEffect(() => {
    const controller = new AbortController();
    setCompiling(true);
    const timer = window.setTimeout(async () => {
      try {
        const compiled = await compileInBrowser(phase < 4 ? initialFiles : files);
        if (controller.signal.aborted) return;
        setPreview(compiled); setBuildError('');
      } catch (error) {
        if (!controller.signal.aborted) setBuildError(error instanceof Error ? error.message : 'Não foi possível preparar o aplicativo.');
      } finally { if (!controller.signal.aborted) setCompiling(false); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [files, phase, runKey]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.channel !== 'dojo-preview') return;
      if (event.data.type === 'search' && phase === 1 && typeof event.data.query === 'string' && event.data.query.trim() && !/[<>]/.test(event.data.query)) {
        setProgress(p => p.happy ? p : { ...p, happy: true });
      }
      if (event.data.type === 'article' && phase === 1) setProgress(p => p.opened ? p : { ...p, opened: true });
      if (event.data.type === 'exploit') {
        setBrowserAlert(typeof event.data.message === 'string' ? event.data.message : '');
        if (phase === 2) setProgress(p => p.exploited ? p : { ...p, exploited: true });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [phase]);

  useEffect(() => {
    if (!guideOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setGuideOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guideOpen]);

  const goToPhase = (next: Phase) => {
    pendingMilestones.current.forEach(clearTimeout); pendingMilestones.current = [];
    setMilestoneQueue(queue => queue.filter(key => !happyPathMilestones.includes(key)));
    setProgress(p => ({ ...p, phase: next, unlocked: Math.max(p.unlocked, next) as Phase }));
    setCandidate(null); setTraceFeedback(null); setCodeHidden(false); setPreviewHidden(false); setBrowserAlert(null);
    codePanel.current?.expand(); previewPanel.current?.expand();
  };
  const selectFile = (name: string) => {
    setSelectedFile(name); setCandidate(null); setTraceFeedback(null);
    if (codeHidden) { codePanel.current?.expand(); setCodeHidden(false); }
  };
  const updateCode = useCallback((value: string) => {
    setProgress(p => ({ ...p, files: { ...p.files, [selectedFile]: value }, report: null }));
    setTestError('');
  }, [selectedFile]);
  const markLine = () => {
    if (!candidate) return;
    const target = traceTargets[traceKind];
    const ok = candidate.file === target.file && candidate.line === target.line;
    setTraceFeedback({ ok, text: ok ? target.explanation : traceKind === 'sink' ? 'Essa linha não é o ponto que interpreta a entrada como HTML. Siga o dado até onde ele aparece na página.' : traceKind === 'source' ? 'Procure a linha que lê o valor digitado no campo de busca.' : 'Procure onde a consulta original é entregue à função que atualiza a interface.' });
    if (ok) { setProgress(p => ({ ...p, marks: { ...p.marks, [traceKind]: true } })); setCandidate(null); }
  };
  const copyPayload = async () => {
    try { await navigator.clipboard.writeText(EXPLOIT_PAYLOAD); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  };
  const runTests = async () => {
    if (testing) return;
    const snapshot = JSON.stringify(files);
    setTesting(true); setTestError(''); setTerminalLines([]); setProgress(p => ({ ...p, report: null }));
    try {
      // The grader finishes in about two seconds; its log is replayed at reading pace.
      const queue: ValidationLog[] = [];
      let finished = false;
      let result: Report | null = null;
      let failure: unknown = null;
      validateChallenge(files, entry => queue.push(entry)).then(value => { result = value; }, error => { failure = error; }).finally(() => { finished = true; });
      while (!finished || queue.length) {
        const entry = queue.shift();
        if (!entry) { await new Promise(resolve => window.setTimeout(resolve, 50)); continue; }
        await new Promise(resolve => window.setTimeout(resolve, TERMINAL_PACE_MS[entry.level] ?? 350));
        setTerminalLines(current => [...current, entry]);
      }
      if (failure) throw failure;
      if (!result) throw new Error('A verificação terminou sem resultado.');
      if (JSON.stringify(latestFiles.current) !== snapshot) {
        setTestError('O código mudou durante a verificação. Execute novamente para testar a versão atual.');
      } else setProgress(p => ({ ...p, report: result }));
    } catch (error) { setTestError(error instanceof Error ? error.message : 'Não foi possível executar os testes.'); }
    finally { setTesting(false); }
  };
  const restart = () => {
    if (!window.confirm('Reiniciar este desafio? Seu código e o progresso salvo neste navegador serão apagados.')) return;
    setProgress(defaultProgress()); setCandidate(null); setTraceFeedback(null); setTestError(''); setTerminalLines([]); setBrowserAlert(null); setSelectedFile('src/main.js'); setRunKey(k => k + 1);
  };
  const resetPatch = () => {
    if (!window.confirm('Restaurar o código original? As alterações do seu patch serão apagadas.')) return;
    setProgress(p => ({ ...p, files: { ...initialFiles }, report: null })); setTestError(''); setTerminalLines([]);
  };
  const toggleCode = () => {
    if (codeHidden) codePanel.current?.expand();
    else { if (previewHidden) previewPanel.current?.expand(); codePanel.current?.collapse(); }
  };
  const togglePreview = () => {
    if (previewHidden) previewPanel.current?.expand();
    else { if (codeHidden) codePanel.current?.expand(); previewPanel.current?.collapse(); }
  };
  const dismissMilestone = useCallback(() => setMilestoneQueue(queue => queue.slice(1)), []);
  const nextEnabled = phase === 1 ? happy && opened : phase === 2 ? exploited : traceDone;

  const actions = phase < 4 ? <button className="button primary" disabled={!nextEnabled} onClick={() => goToPhase((phase + 1) as Phase)}>{phase === 1 ? 'Explorar vulnerabilidade' : phase === 2 ? 'Investigar o código' : 'Começar a correção'}<ArrowRight size={16} /></button> : <div className="action-group"><button className="button ghost" onClick={resetPatch} disabled={!hasPatch || testing}><RotateCcw size={14} />Restaurar código</button><button className="button primary" onClick={runTests} disabled={testing || !!buildError || compiling}>{testing ? <RefreshCw size={15} className="spin" /> : <Play size={15} fill="currentColor" />}{testing ? 'Verificando…' : 'Executar ataque automatizado'}</button></div>;

  const previewPane = <section className="browser-pane" aria-label="Aplicação do desafio">
    <div className="pane-toolbar browser-toolbar">
      <div className="browser-dots" aria-hidden="true"><i /><i /><i /></div>
      <div className="address"><LockKeyhole size={12} /><span>nexo.local / ajuda</span></div>
      <button className="icon-button" onClick={() => { setBrowserAlert(null); setRunKey(k => k + 1); }} title="Recarregar aplicação" aria-label="Recarregar aplicação"><RefreshCw size={15} className={compiling ? 'spin' : ''} /></button>
      {codeAvailable && <button className="icon-button" onClick={toggleCode} title={codeHidden ? 'Restaurar código' : 'Ampliar aplicação'} aria-label={codeHidden ? 'Restaurar código' : 'Ampliar aplicação'}>{codeHidden ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
    </div>
    <div className="browser-body">
      {preview && <iframe ref={iframeRef} title="Nexo: aplicação do desafio" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={preview.html} key={`${preview.revision}-${runKey}-${phase}`} />}
      {!preview && !buildError && <div className="loading-state"><RefreshCw size={20} className="spin" /><p>Preparando a aplicação…</p></div>}
      {browserAlert !== null && <div className="browser-dialog-layer"><div className="browser-dialog" role="alertdialog" aria-modal="true" aria-labelledby="browser-dialog-origin" aria-describedby="browser-dialog-message"><strong id="browser-dialog-origin">nexo.local diz</strong><p id="browser-dialog-message">{browserAlert}</p><button autoFocus onClick={() => setBrowserAlert(null)} onKeyDown={event => { if (event.key === 'Escape') setBrowserAlert(null); }}>OK</button></div></div>}
      {buildError && <div className="build-error" role="alert"><div><Terminal size={20} /><strong>Vamos ajustar o código</strong><p>O aplicativo não pôde ser atualizado.</p><pre>{buildError}</pre></div></div>}
    </div>
    <div className="browser-status"><span className="status-dot" /><span>{compiling ? 'Atualizando aplicação…' : buildError ? 'Aguardando correção' : 'Aplicação em execução'}</span><span className="status-right">Ambiente de prática</span></div>
  </section>;

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setGuideOpen(true); }} aria-label="Dojo Shield: guia"><span className="brand-icon"><ShieldCheck size={21} strokeWidth={1.8} /></span><span>dojo<span className="brand-secondary">shield</span></span></a>
      <div className="header-divider" />{!sidebarOpen && <button className="icon-button" onClick={() => setSidebarOpen(true)} title="Mostrar sidebar" aria-label="Mostrar sidebar"><PanelLeftOpen size={18} /></button>}
      <div className="breadcrumb"><span>Laboratório</span><ChevronRight size={14} /><strong>Busca sob controle</strong></div>
      <div className="challenge-meta"><span className="tag">DOM XSS</span><span>Iniciante</span><span className="meta-dot">·</span><span>15 a 20 min</span></div>
      <div className="header-actions"><span className="local-label"><span className="status-dot" />Sessão local</span><button className="icon-button" onClick={() => setGuideOpen(true)} aria-label="Guia do laboratório" title="Guia do laboratório"><BookOpen size={18} /></button><button className="icon-button" onClick={restart} aria-label="Reiniciar desafio" title="Reiniciar desafio"><RotateCcw size={17} /></button></div>
    </header>

    <div className={`workbench ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      {sidebarOpen && <aside className="sidebar" aria-label="Roteiro e arquivos">
        <Accordion.Root type="multiple" value={accordions} onValueChange={setAccordions} className="sidebar-accordions">
          <Accordion.Item value="files" className="accordion-item files-accordion">
            <Accordion.Header><Accordion.Trigger className="accordion-trigger"><Folder size={16} /><span>Arquivos do projeto</span>{codeAvailable ? <span className="accordion-count">5</span> : <LockKeyhole size={13} />}<ChevronDown className="accordion-chevron" size={15} /></Accordion.Trigger></Accordion.Header>
            <Accordion.Content className="accordion-content">
              {codeAvailable ? <nav className="file-tree" aria-label="Arquivos do projeto"><FileItem name="index.html" active={selectedFile === 'index.html'} onClick={() => selectFile('index.html')} locked /><button className="folder-row" onClick={() => setFolderOpen(!folderOpen)} aria-expanded={folderOpen}>{folderOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={15} /><span>src</span></button>{folderOpen && editableFiles.map(name => <FileItem key={name} name={name} active={selectedFile === name} nested onClick={() => selectFile(name)} modified={files[name] !== initialFiles[name]} />)}<FileItem name="styles.css" active={selectedFile === 'styles.css'} onClick={() => selectFile('styles.css')} locked /></nav> : <div className="files-locked"><LockKeyhole size={16} /><p>O código aparece na etapa 3.<br /><span>Por enquanto, explore a aplicação.</span></p></div>}
            </Accordion.Content>
          </Accordion.Item>
          <Accordion.Item value="story" className="accordion-item story-accordion">
            <Accordion.Header><Accordion.Trigger className="accordion-trigger"><BookOpen size={16} /><span>Cenário e etapas</span><span className="accordion-count">{complete ? 4 : phase - 1}/4</span><ChevronDown className="accordion-chevron" size={15} /></Accordion.Trigger></Accordion.Header>
            <nav className="step-timeline" aria-label="Etapas do desafio">{steps.map(step => {
              const done = step.id < unlocked || (step.id === 4 && complete);
              const active = step.id === phase;
              return <button key={step.id} className={`timeline-step ${active ? 'active' : ''} ${done ? 'done' : ''}`} disabled={step.id > unlocked} onClick={() => goToPhase(step.id)} aria-current={active ? 'step' : undefined} title={step.id > unlocked ? `${step.name} (bloqueada)` : step.name}><span className="timeline-dot">{done ? <Check size={9} strokeWidth={3} /> : step.id}</span><span className="timeline-label">{step.short}</span><span className="timeline-subphases" aria-label={subphases[step.id].map(sub => `${sub.label}: ${sub.done ? 'concluída' : 'pendente'}`).join(', ')}>{subphases[step.id].map(sub => <i key={sub.label} className={sub.done ? 'done' : ''} title={sub.label} />)}</span></button>;
            })}</nav>
            <Accordion.Content className="accordion-content">
              
              <div className="story-content">
                {phase === 1 && <><h3>Uma busca que ajuda.</h3><p>A Nexo reúne respostas para as dúvidas dos seus clientes. Você entrou no time para revisar a segurança da central de ajuda.</p><p>Antes de investigar, conheça a experiência de quem usa o produto.</p><div className="task-callout"><span className="mini-label">SUA PRIMEIRA MISSÃO</span><p>Busque por <strong>senha</strong> e abra um dos artigos encontrados.</p></div><div className={`checkpoint ${happy ? 'checked' : ''}`}>{happy ? <CheckCircle2 size={16} /> : <Circle size={16} />}<span>{happy ? 'Busca realizada.' : 'Faça uma busca no aplicativo'}</span></div><div className={`checkpoint ${opened ? 'checked' : ''}`}>{opened ? <CheckCircle2 size={16} /> : <Circle size={16} />}<span>{opened ? 'Artigo aberto. Caminho feliz conhecido.' : 'Abra um dos artigos'}</span></div></>}
                {phase === 2 && <><h3>Quando um texto vira código.</h3><p>A busca exibe na página o termo digitado. Mas e se esse termo contiver HTML com JavaScript?</p><p>Isso pode permitir um <strong>Cross-Site Scripting (XSS)</strong>: código de outra pessoa executado dentro da aplicação.</p><div className="payload-card"><div><span className="mini-label">EXPERIMENTE NA BUSCA</span><button className="icon-button" onClick={copyPayload} aria-label="Copiar payload" title="Copiar payload">{copied ? <Check size={14} /> : <Clipboard size={14} />}</button></div><code>{EXPLOIT_PAYLOAD}</code></div><p className="text-small">Cole o conteúdo no campo de busca e clique em Buscar. Observe o alerta do navegador.</p><div className={`checkpoint ${exploited ? 'checked' : ''}`}>{exploited ? <CheckCircle2 size={16} /> : <Circle size={16} />}<span>{exploited ? 'JavaScript executado. Falha reproduzida.' : 'Reproduza o efeito do XSS'}</span></div></>}
                {phase === 3 && <><h3>{traceDone ? 'O percurso está completo.' : 'Siga o dado.'}</h3><p>{traceDone ? 'Você conectou a entrada do usuário à operação que interpreta esse conteúdo como HTML.' : 'Primeiro, encontre a linha que transforma a consulta em HTML. Depois, rastreie de onde o dado veio e como chegou ali.'}</p><div className="trace-checklist">{(['sink', 'source', 'flow'] as TraceKind[]).map(kind => <div className={`trace-item ${marks[kind] ? 'done' : traceKind === kind ? 'current' : ''}`} key={kind}>{marks[kind] ? <CheckCircle2 size={15} /> : <Circle size={15} />}<span>{markNames[kind]}</span></div>)}</div>{!traceDone && <div className="task-callout"><span className="mini-label">LOCALIZE: {markNames[traceKind].toUpperCase()}</span><p>Clique no número de uma linha do editor e confirme sua seleção.</p></div>}{traceDone && <div className="flow-summary"><span>main.js <small>entrada</small></span><ArrowRight size={14} /><span>search.js <small>passagem</small></span><ArrowRight size={14} /><span>render.js <small>destino</small></span></div>}{traceFeedback && <p className={`feedback ${traceFeedback.ok ? 'success' : 'hint'}`} role="status">{traceFeedback.ok ? <CheckCircle2 size={15} /> : <Info size={15} />}{traceFeedback.text}</p>}</>}
                {phase === 4 && <><h3>{complete ? 'Você protegeu a busca.' : 'Uma correção que preserva o produto.'}</h3><p>{complete ? 'O patch passou pelos ataques e pelos testes de funcionamento deste desafio.' : 'Edite o código para exibir o termo como texto, preservando a busca e a abertura dos artigos.'}</p><div className="requirements"><span className="mini-label">O QUE PRECISA CONTINUAR FUNCIONANDO</span><p><Check size={14} />Buscar e abrir artigos</p><p><Check size={14} />Mostrar o termo pesquisado</p><p><Check size={14} />Tratar entradas como texto</p></div><div className="study-card"><span className="mini-label"><GraduationCap size={13} />ESTUDE ANTES DE CORRIGIR</span><p>Como o navegador trata o que você escreve no DOM? Compare na documentação: {domWriteApis.map((api, index) => <span key={api.name}>{index > 0 && ', '}<a href={MDN + api.path} target="_blank" rel="noopener noreferrer"><code>{api.name}</code></a></span>)}.</p><p>Comece pela <a href={MDN + 'Document_Object_Model/Introduction'} target="_blank" rel="noopener noreferrer">introdução ao DOM</a> no MDN.</p></div><p className="text-small">O aplicativo atualiza após suas edições. Use o ataque automatizado para verificar seu patch.</p>{complete && <div className="completion-note"><ShieldCheck size={22} /><strong>Desafio concluído</strong><span>Explorar → compreender → corrigir.</span></div>}</>}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
        <div className="sidebar-actions">{actions}</div>
        <div className="sidebar-footer"><span className="status-dot" /><span>{saveError ? 'Armazenamento indisponível nesta sessão' : 'Progresso salvo neste navegador'}</span><button className="icon-button sidebar-collapse" onClick={() => setSidebarOpen(false)} title="Recolher sidebar" aria-label="Recolher sidebar"><PanelLeftClose size={16} /></button></div>
      </aside>}

      <main className="workspace">
        <div className={`working-area ${codeAvailable ? 'with-editor' : 'preview-only'}`}>
          {codeAvailable ? <PanelGroup direction="horizontal" autoSaveId="dojo-panels" className="workspace-panels">
            <Panel ref={codePanel} defaultSize={54} minSize={28} collapsible collapsedSize={0} onCollapse={() => setCodeHidden(true)} onExpand={() => setCodeHidden(false)} order={1} id="code"><section className="code-pane" aria-label="Editor de código"><div className="pane-toolbar"><FileCode2 size={15} /><span className="file-path">{selectedFile}</span><span className={`editor-mode ${phase === 4 && editableFiles.includes(selectedFile) ? 'editable' : ''}`}>{phase === 4 && editableFiles.includes(selectedFile) ? 'Editável' : 'Somente leitura'}</span><button className="icon-button" onClick={togglePreview} aria-label={previewHidden ? 'Restaurar aplicação' : 'Ampliar código'} title={previewHidden ? 'Restaurar aplicação' : 'Ampliar código'}>{previewHidden ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button></div><CodeEditor filePath={selectedFile} value={visibleFiles[selectedFile]} readOnly={phase !== 4 || !editableFiles.includes(selectedFile)} onChange={updateCode} onSelectLine={line => { if (phase === 3) { setCandidate({ file: selectedFile, line }); setTraceFeedback(null); } }} activeLine={candidate?.file === selectedFile ? candidate.line : undefined} selectedLines={phase === 3 ? (Object.keys(traceTargets) as TraceKind[]).filter(kind => marks[kind] && traceTargets[kind].file === selectedFile).map(kind => ({ line: traceTargets[kind].line, kind })) : []} /><div className="editor-status"><span>{selectedFile.endsWith('.js') ? 'JavaScript' : selectedFile.endsWith('.html') ? 'HTML' : 'CSS'}</span><span>{candidate?.file === selectedFile ? `Linha ${candidate.line}` : `${visibleFiles[selectedFile].split('\n').length} linhas`}</span><span className="status-right">UTF-8</span></div>{phase === 3 && traceFeedback && <p className={`selection-feedback ${traceFeedback.ok ? 'success' : 'hint'}`} role="status">{traceFeedback.ok ? <CheckCircle2 size={14} /> : <Info size={14} />}<span>{traceFeedback.ok ? <strong>{markNames[(['sink', 'source', 'flow'] as TraceKind[]).filter(kind => marks[kind]).pop() || 'sink']} encontrado. </strong> : null}{traceFeedback.text}</span></p>}{phase === 3 && !traceDone && <div className="selection-bar"><span>{candidate ? `${candidate.file.split('/').pop()} : ${candidate.line}` : 'Selecione uma linha'}</span><button className="button small secondary" onClick={markLine} disabled={!candidate}><Target size={13} />Marcar {traceKind === 'sink' ? 'vulnerabilidade' : traceKind === 'source' ? 'entrada' : 'passagem'}</button></div>}</section></Panel>
            <PanelResizeHandle className="resize-handle" aria-label="Redimensionar código e aplicação"><span /></PanelResizeHandle>
            <Panel ref={previewPanel} defaultSize={46} minSize={28} collapsible collapsedSize={0} onCollapse={() => setPreviewHidden(true)} onExpand={() => setPreviewHidden(false)} order={2} id="preview">{previewPane}</Panel>
          </PanelGroup> : phase === 1 && !launched ? <section className="launch-screen" aria-labelledby="launch-title">
            <div className="launch-card">
              <span className="launch-pointer"><ArrowLeft size={15} />Comece pelo cenário ao lado</span>
              <span className="launch-icon"><Monitor size={26} strokeWidth={1.6} /></span>
              <h2 id="launch-title">Antes de abrir a aplicação</h2>
              <p>Leia o cenário e a sua primeira missão na barra lateral. Ela acompanha você em todas as etapas e mostra o que fazer a seguir.</p>
              <button className="button primary" onClick={() => { setSidebarOpen(true); setAccordions(open => open.includes('story') ? open : [...open, 'story']); setProgress(p => ({ ...p, launched: true })); }}><Monitor size={15} />Abrir aplicação<ArrowRight size={15} /></button>
            </div>
          </section> : previewPane}
        </div>

        {phase === 4 && (testing || report || testError || terminalLines.length > 0) && <AttackTerminal lines={terminalLines} running={testing} report={report} error={testError} />}

        {!sidebarOpen && <footer className="workspace-footer">{actions}</footer>}
      </main>
    </div>
    {milestoneQueue.length > 0 && browserAlert === null && <MilestoneDialog key={milestoneQueue[0]} eyebrow={milestoneStep[milestoneQueue[0]]} {...milestones[milestoneQueue[0]]} final={milestoneQueue[0] === 'patched'} onClose={dismissMilestone} />}
    {guideOpen && <div className="modal-backdrop" onClick={() => setGuideOpen(false)}><section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" autoFocus onClick={() => setGuideOpen(false)} aria-label="Fechar guia"><X size={18} /></button><span className="brand-icon"><ShieldCheck size={25} /></span><span className="eyebrow">APRENDA FAZENDO</span><h2 id="guide-title">Do comportamento ao código seguro.</h2><p>Este laboratório guia você pelas quatro etapas de um desafio de segurança.</p><div className="guide-steps">{steps.map(step => <div key={step.id}><step.icon size={19} /><span><strong>{step.name}</strong><small>{step.subtitle}</small></span></div>)}</div><p className="text-small">Seu código e progresso ficam salvos somente neste navegador. Você pode voltar às etapas concluídas ou reiniciar pelo ícone no topo.</p><button className="button primary" onClick={() => setGuideOpen(false)}>Continuar no laboratório<ArrowRight size={15} /></button></section></div>}
  </div>;
}

function FileItem({ name, active, onClick, nested, locked, modified }: { name: string; active: boolean; onClick: () => void; nested?: boolean; locked?: boolean; modified?: boolean }) {
  return <button className={`file-row ${active ? 'active' : ''} ${nested ? 'nested' : ''}`} onClick={onClick} aria-current={active ? 'true' : undefined}>{name.endsWith('.js') ? <span className="js-icon" aria-hidden="true">JS</span> : <FileText size={14} />}<span>{name.split('/').pop()}</span>{modified && <span className="modified-dot" title="Arquivo modificado" />}{locked && <LockKeyhole size={11} className="file-lock" />}</button>;
}
