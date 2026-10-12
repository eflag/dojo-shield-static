import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, ShieldCheck, ShieldAlert, TerminalSquare } from 'lucide-react';

export type TerminalLevel = 'command' | 'step' | 'action' | 'pass' | 'fail' | 'info';
export type TerminalLine = { level: TerminalLevel; text: string; elapsedMs: number };
type Report = { passed: boolean; revision: string; durationMs: number; checks: { id: string; label: string; status: 'passed' | 'failed'; detail: string }[] };

const prefix: Record<TerminalLevel, string> = { command: '$', step: '▸', action: '→', pass: '✓', fail: '✗', info: '·' };

/** Replays a saved report when no live stream is available (e.g. after a reload). */
function linesFromReport(report: Report): TerminalLine[] {
  const lines: TerminalLine[] = [{ level: 'info', text: `resultado salvo · revisão ${report.revision}`, elapsedMs: 0 }];
  report.checks.forEach((check, index) => {
    lines.push({ level: 'step', text: `[${index + 1}/${report.checks.length}] ${check.label}`, elapsedMs: 0 });
    lines.push({ level: check.status === 'passed' ? 'pass' : 'fail', text: check.detail, elapsedMs: 0 });
  });
  const passed = report.checks.filter((check) => check.status === 'passed').length;
  lines.push({ level: report.passed ? 'pass' : 'fail', text: `${passed}/${report.checks.length} verificações passaram em ${(report.durationMs / 1000).toFixed(1)}s`, elapsedMs: report.durationMs });
  return lines;
}

export function AttackTerminal({ lines, running, report, error }: { lines: TerminalLine[]; running: boolean; report: Report | null; error: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const shown = lines.length ? lines : report ? linesFromReport(report) : [];
  const status = running ? 'running' : error ? 'error' : report?.passed ? 'passed' : report ? 'failed' : 'idle';
  const title = { running: 'Executando ataque automatizado…', error: 'Verificação não concluída', passed: 'Patch aprovado. Funcionalidade preservada.', failed: 'Seu patch ainda precisa de ajustes', idle: '' }[status];

  useEffect(() => { if (running) setCollapsed(false); }, [running]);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }); }, [shown.length, error, collapsed]);

  return <section className={`attack-terminal ${status} ${collapsed ? 'collapsed' : ''}`} aria-label="Terminal do ataque automatizado">
    <button className="terminal-bar" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>
      <span className="terminal-dots" aria-hidden="true"><i /><i /><i /></span>
      <TerminalSquare size={14} />
      <span className="terminal-name">dojo-attack</span>
      <span className="terminal-status">{status === 'running' ? <RefreshCw size={13} className="spin" /> : status === 'passed' ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}{title}</span>
      <ChevronDown size={14} className="terminal-chevron" />
    </button>
    {!collapsed && <div className="terminal-body" ref={body} role="log" aria-live="polite">
      <p className="terminal-line command"><span className="terminal-prefix">$</span><span>dojo attack --target nexo.local --checks funcionalidade,xss</span></p>
      {shown.map((line, index) => <p key={index} className={`terminal-line ${line.level}`}>
        <span className="terminal-time">{(line.elapsedMs / 1000).toFixed(2).padStart(5, ' ')}s</span>
        <span className="terminal-prefix">{prefix[line.level]}</span>
        <span>{line.text}</span>
      </p>)}
      {error && <p className="terminal-line fail"><span className="terminal-prefix">✗</span><span>{error}</span></p>}
      {running && <p className="terminal-line cursor"><span className="terminal-caret" /></p>}
    </div>}
  </section>;
}
