import { useLayoutEffect, useRef } from 'react';
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import './editor.css';

export type SelectedCodeLine = { line: number; kind: 'source' | 'flow' | 'sink' };

export interface CodeEditorProps {
  filePath: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSelectLine: (line: number) => void;
  selectedLines?: SelectedCodeLine[];
  activeLine?: number;
}

type ReviewMarks = { lines: SelectedCodeLine[]; activeLine?: number };
type MarkState = { decorations: DecorationSet; gutters: RangeSet<GutterMarker> };
type SavedDocument = { state: EditorState; scrollTop: number; scrollLeft: number };

const externalUpdate = Annotation.define<boolean>();
const updateReviewMarks = StateEffect.define<ReviewMarks>();

class ReviewGutterMarker extends GutterMarker {
  elementClass: string;

  constructor(readonly kind: SelectedCodeLine['kind']) {
    super();
    this.elementClass = `cm-review-gutter-${kind}`;
  }

  eq(other: ReviewGutterMarker) {
    return this.kind === other.kind;
  }
}

function buildMarks(state: EditorState, marks: ReviewMarks): MarkState {
  const lineKinds = new Map<number, SelectedCodeLine['kind']>();
  for (const mark of marks.lines) {
    if (Number.isInteger(mark.line) && mark.line > 0 && mark.line <= state.doc.lines) {
      lineKinds.set(mark.line, mark.kind);
    }
  }

  const lineDecorations = [...lineKinds].map(([line, kind]) =>
    Decoration.line({
      class: `cm-review-line cm-review-${kind}`,
      attributes: { 'data-review-kind': kind },
    }).range(state.doc.line(line).from),
  );

  if (marks.activeLine && Number.isInteger(marks.activeLine) && marks.activeLine > 0 && marks.activeLine <= state.doc.lines) {
    lineDecorations.push(
      Decoration.line({ class: 'cm-review-current' }).range(state.doc.line(marks.activeLine).from),
    );
  }

  return {
    decorations: Decoration.set(lineDecorations, true),
    gutters: RangeSet.of(
      [...lineKinds].map(([line, kind]) => new ReviewGutterMarker(kind).range(state.doc.line(line).from)),
      true,
    ),
  };
}

const reviewField = StateField.define<MarkState>({
  create: () => ({ decorations: Decoration.none, gutters: RangeSet.empty }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(updateReviewMarks)) return buildMarks(transaction.state, effect.value);
    }
    return transaction.docChanged
      ? { decorations: value.decorations.map(transaction.changes), gutters: value.gutters.map(transaction.changes) }
      : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    gutterLineClass.from(field, (value) => value.gutters),
  ],
});

function languageFor(path: string): Extension {
  if (/\.html?$/i.test(path)) return html();
  if (/\.css$/i.test(path)) return css();
  if (/\.[cm]?[jt]sx?$/i.test(path)) {
    return javascript({ typescript: /\.tsx?$/i.test(path), jsx: /\.[jt]sx$/i.test(path) });
  }
  return [];
}

export function CodeEditor(props: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  const documentsRef = useRef(new Map<string, SavedDocument>());
  const fileRef = useRef(props.filePath);
  const readOnlyCompartment = useRef(new Compartment());
  const labelCompartment = useRef(new Compartment());
  const createStateRef = useRef<((path: string, value: string) => EditorState) | null>(null);
  const configurationRef = useRef('');
  propsRef.current = props;

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const createState = (path: string, value: string) => EditorState.create({
      doc: value,
      extensions: [
        lineNumbers({
          domEventHandlers: {
            mousedown(view, block, event) {
              if (!propsRef.current.readOnly || (event as MouseEvent).button !== 0) return false;
              event.preventDefault();
              const line = view.state.doc.lineAt(block.from);
              view.dispatch({
                selection: { anchor: line.from },
                scrollIntoView: true,
                annotations: externalUpdate.of(true),
              });
              view.focus();
              propsRef.current.onSelectLine(line.number);
              return true;
            },
          },
        }),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorState.tabSize.of(2),
        languageFor(path),
        reviewField,
        readOnlyCompartment.current.of(EditorState.readOnly.of(propsRef.current.readOnly)),
        labelCompartment.current.of(EditorView.contentAttributes.of({
          'aria-label': `Código de ${path}`,
          'aria-readonly': String(propsRef.current.readOnly),
          spellcheck: 'false',
        })),
        EditorView.updateListener.of((update) => {
          const isExternal = update.transactions.some((transaction) => transaction.annotation(externalUpdate));
          if (update.docChanged && !isExternal) propsRef.current.onChange(update.state.doc.toString());
          if (update.selectionSet && propsRef.current.readOnly && !isExternal) {
            propsRef.current.onSelectLine(update.state.doc.lineAt(update.state.selection.main.head).number);
          }
        }),
      ],
    });

    createStateRef.current = createState;
    const view = new EditorView({
      state: createState(propsRef.current.filePath, propsRef.current.value),
      parent: containerRef.current,
    });
    fileRef.current = propsRef.current.filePath;
    viewRef.current = view;
    configurationRef.current = '';

    return () => {
      view.destroy();
      viewRef.current = null;
      documentsRef.current.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !createStateRef.current) return;

    const changedFile = fileRef.current !== props.filePath;
    if (changedFile) {
      documentsRef.current.set(fileRef.current, {
        state: view.state,
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
      });
      const saved = documentsRef.current.get(props.filePath);
      fileRef.current = props.filePath;
      view.setState(saved?.state ?? createStateRef.current(props.filePath, props.value));
      view.scrollDOM.scrollTop = saved?.scrollTop ?? 0;
      view.scrollDOM.scrollLeft = saved?.scrollLeft ?? 0;
    }

    const changedExternally = view.state.doc.toString() !== props.value;
    if (changedExternally) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.value },
        annotations: [externalUpdate.of(true), Transaction.addToHistory.of(false)],
      });
    }

    const configuration = JSON.stringify([props.filePath, props.readOnly, props.selectedLines, props.activeLine]);
    if (changedExternally || configurationRef.current !== configuration) {
      view.dispatch({
        effects: [
          readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(props.readOnly)),
          labelCompartment.current.reconfigure(EditorView.contentAttributes.of({
            'aria-label': `Código de ${props.filePath}`,
            'aria-readonly': String(props.readOnly),
            spellcheck: 'false',
          })),
          updateReviewMarks.of({ lines: props.selectedLines ?? [], activeLine: props.activeLine }),
        ],
        annotations: externalUpdate.of(true),
      });
      configurationRef.current = configuration;
    }
  }, [props.filePath, props.value, props.readOnly, props.selectedLines, props.activeLine]);

  return (
    <div
      ref={containerRef}
      className={`code-editor ${props.readOnly ? 'code-editor--review' : 'code-editor--edit'}`}
      data-file-path={props.filePath}
    />
  );
}
