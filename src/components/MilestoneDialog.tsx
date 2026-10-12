import { ArrowRight } from 'lucide-react';

/** Centered celebration shown each time the student completes a sub-phase. Only the button dismisses it. */
export function MilestoneDialog({ eyebrow, title, text, final, onClose }: { eyebrow: string; title: string; text: string; final?: boolean; onClose: () => void }) {
  return <div className="milestone-backdrop">
    <section className={`milestone-dialog ${final ? 'final' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="milestone-title" aria-describedby="milestone-text">
      <svg className="milestone-check" viewBox="0 0 52 52" aria-hidden="true">
        <circle className="milestone-check-ring" cx="26" cy="26" r="23" />
        <path className="milestone-check-mark" d="M15 27l7 7 15-16" />
      </svg>
      <span className="eyebrow">{eyebrow}</span>
      <h2 id="milestone-title">{title}</h2>
      <p id="milestone-text">{text}</p>
      <button className="button primary" autoFocus onClick={onClose}>Continuar<ArrowRight size={15} /></button>
    </section>
  </div>;
}
