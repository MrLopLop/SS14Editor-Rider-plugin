import * as vscode from 'vscode';

import { foldedText, locIdSpansIn, type LocalizationIndexView, type LocIdSpan } from '../core';
import type { ForkStatusController } from './fork-status-controller';
import type { SchemaController } from './schema-controller';
import { displayLocale, foldingEnabled, LOCALIZATION_SECTION } from './localization-settings';
import { selectorFor } from './text-providers';

/** Re-scan a document this long after its last edit; the decorations ride along with the text meanwhile. */
const EDIT_DEBOUNCE_MS = 150;

/**
 * Folds every LocId key in a visible prototype editor into its translation, the
 * way Android Studio folds `R.string.*`: the key's text is hidden and the
 * translation is drawn in its place on a fold-coloured chip. While a caret or
 * selection touches a key, that key shows as written — clicking the chip puts
 * the caret there — and folds back once the caret leaves.
 *
 * A key no locale declares is left as written. Nothing folds until the schema
 * (which says which fields are `LocId`) and the localization index are ready.
 */
export class LocIdFoldingController implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    // The classic injection: VS Code writes this into the span's inline style,
    // and `display: none` hides the key's own text while the `before`
    // attachment, a sibling span, stays visible.
    textDecoration: 'none; display: none;',
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

  /** LocId spans per document, valid for the version they were read at. */
  private readonly spans = new Map<string, { readonly version: number; readonly spans: readonly LocIdSpan[] }>();
  private readonly editTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly forkStatus: ForkStatusController,
    private readonly schema: SchemaController,
    private readonly index: LocalizationIndexView,
    onIndexUpdate: vscode.Event<void>,
  ) {
    const refreshAll = () => {
      this.spans.clear();
      this.refreshAll();
    };
    this.disposables.push(
      this.decoration,
      onIndexUpdate(refreshAll),
      this.schema.onDidChange(refreshAll),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        // While typing, the debounced re-scan after the edit refreshes it; the
        // folds ride along with the text until then.
        if (!this.editTimers.has(event.textEditor.document.uri.toString())) this.refresh(event.textEditor);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => this.onEdited(event.document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.spans.delete(document.uri.toString())),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(LOCALIZATION_SECTION)) this.refreshAll();
      }),
    );
    this.refreshAll();
  }

  private onEdited(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const pending = this.editTimers.get(key);
    if (pending) clearTimeout(pending);
    this.editTimers.set(
      key,
      setTimeout(() => {
        this.editTimers.delete(key);
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === document) this.refresh(editor);
        }
      }, EDIT_DEBOUNCE_MS),
    );
  }

  private refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) this.refresh(editor);
  }

  private refresh(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decoration, this.foldsFor(editor));
  }

  private foldsFor(editor: vscode.TextEditor): vscode.DecorationOptions[] {
    const root = this.forkStatus.recognizedRoot();
    const schema = this.schema.schema;
    const document = editor.document;
    if (!root || !schema || !this.index.ready || !foldingEnabled()) return [];
    if (vscode.languages.match(selectorFor(root.uri), document) === 0) return [];

    const locale = displayLocale();
    const folds: vscode.DecorationOptions[] = [];
    for (const span of this.spansOf(document, schema)) {
      const range = new vscode.Range(document.positionAt(span.range[0]), document.positionAt(span.range[1]));
      // Inclusive at both ends: a caret just before or after the key unfolds it too.
      if (editor.selections.some((selection) => selection.intersection(range) !== undefined)) continue;
      const preview = this.index.preview(span.key, locale);
      if (preview === null) continue;
      folds.push({
        range,
        renderOptions: {
          before: {
            contentText: foldedText(preview),
            color: new vscode.ThemeColor('debugTokenExpression.string'),
            backgroundColor: new vscode.ThemeColor('editor.foldBackground'),
            textDecoration: 'none; border-radius: 3px; padding: 0 2px;',
          },
        },
      });
    }
    return folds;
  }

  private spansOf(document: vscode.TextDocument, schema: NonNullable<SchemaController['schema']>): readonly LocIdSpan[] {
    const key = document.uri.toString();
    const cached = this.spans.get(key);
    if (cached?.version === document.version) return cached.spans;
    const spans = locIdSpansIn(document.getText(), schema, (id) => this.index.has(id));
    this.spans.set(key, { version: document.version, spans });
    return spans;
  }

  dispose(): void {
    for (const timer of this.editTimers.values()) clearTimeout(timer);
    for (const disposable of this.disposables) disposable.dispose();
  }
}
