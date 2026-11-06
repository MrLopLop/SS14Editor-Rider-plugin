import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import * as vscode from 'vscode';

import { collectLocRecords, LOCALE_ROOTS, LocalizationIndex, localeOf } from '../core';
import type { ForkStatusController } from './fork-status-controller';
import type { FromWorker, ToWorker } from './localization-index-worker';

/** Saves land in bursts (Save All, a git checkout); batch them into one worker update. */
const UPDATE_DEBOUNCE_MS = 200;
/** Typing in an open `.ftl`: re-read its unsaved text this long after the last keystroke. */
const EDIT_DEBOUNCE_MS = 300;

/** Everything under the locale roots: a deleted folder is reported once, by its own path. */
const WATCH_GLOB = `{${LOCALE_ROOTS.join(',')}}/**`;

/**
 * Owns the localization index: every Fluent key of every locale under
 * `Resources/Locale/**` and the engine's `RobustToolbox/Resources/Locale/**`.
 *
 *   - Builds in a worker thread ({@link import('./localization-index-worker')});
 *     until the first load, {@link index} is not ready and LocId features stay silent.
 *   - Saves, creates and deletes under the locale roots are re-read by the worker.
 *   - The unsaved text of an open `.ftl` is read on this thread as it is typed
 *     (one file parses in well under a millisecond), so previews follow edits
 *     before they are saved; closing it unsaved re-reads it from disk.
 *   - Logs to the Output channel; writes nothing.
 */
export class LocalizationIndexController implements vscode.Disposable {
  readonly index = new LocalizationIndex();

  private worker: Worker | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private forkRoot: string | undefined;
  private pendingPaths = new Set<string>();
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly editTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly disposables: vscode.Disposable[] = [];
  private readonly updateEmitter = new vscode.EventEmitter<void>();

  /** Fires after the index changes: a full load, a reset, or any file's keys changing. */
  readonly onDidUpdate = this.updateEmitter.event;

  constructor(
    private readonly forkStatus: ForkStatusController,
    private readonly log: vscode.OutputChannel,
  ) {
    this.disposables.push(
      this.updateEmitter,
      this.forkStatus.onDidChange(() => this.onForkStatusChanged()),
      vscode.workspace.onDidChangeTextDocument((event) => this.onEdited(event.document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.onClosed(document)),
    );
    this.onForkStatusChanged();
  }

  private onForkStatusChanged(): void {
    const root = this.forkStatus.recognizedRoot();
    if (!root) {
      this.stop();
      return;
    }
    if (root.uri.fsPath !== this.forkRoot) this.start(root.uri);
  }

  private start(rootUri: vscode.Uri): void {
    this.stop();
    this.forkRoot = rootUri.fsPath;

    const worker = new Worker(path.join(__dirname, 'localization-index-worker.js'));
    this.worker = worker;
    worker.on('message', (message: FromWorker) => {
      if (this.worker === worker) this.onWorkerMessage(message);
    });
    worker.on('error', (err) => {
      if (this.worker === worker) this.log.appendLine(`[locale] worker crashed: ${err.stack ?? err.message}`);
    });
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.log.appendLine(`[locale] worker exited with code ${code}`);
    });

    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(rootUri, WATCH_GLOB));
    const queue = (uri: vscode.Uri) => this.queueUpdate(uri.fsPath);
    this.watcher.onDidChange(queue);
    this.watcher.onDidCreate(queue);
    this.watcher.onDidDelete(queue);

    this.log.appendLine('[locale] Indexing localization…');
    this.send({ type: 'build', forkRoot: rootUri.fsPath });
  }

  private stop(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    this.pendingPaths.clear();
    for (const timer of this.editTimers.values()) clearTimeout(timer);
    this.editTimers.clear();
    this.watcher?.dispose();
    this.watcher = undefined;
    if (this.worker) void this.worker.terminate();
    this.worker = undefined;
    const wasActive = this.forkRoot !== undefined;
    this.forkRoot = undefined;
    if (wasActive) {
      this.index.reset();
      this.updateEmitter.fire();
    }
  }

  /** Fork-relative path of an `.ftl` file under a locale root, or `undefined`. */
  private localeFileOf(document: vscode.TextDocument): string | undefined {
    if (this.forkRoot === undefined || document.uri.scheme !== 'file' || !document.uri.fsPath.endsWith('.ftl')) {
      return undefined;
    }
    const rel = path.relative(this.forkRoot, document.uri.fsPath).split(path.sep).join('/');
    return localeOf(rel) === null ? undefined : rel;
  }

  private onEdited(document: vscode.TextDocument): void {
    const rel = this.localeFileOf(document);
    if (rel === undefined || !this.index.ready) return;
    const pending = this.editTimers.get(rel);
    if (pending) clearTimeout(pending);
    this.editTimers.set(
      rel,
      setTimeout(() => {
        this.editTimers.delete(rel);
        if (this.index.updateFile(rel, collectLocRecords(document.getText(), rel))) this.updateEmitter.fire();
      }, EDIT_DEBOUNCE_MS),
    );
  }

  private onClosed(document: vscode.TextDocument): void {
    const rel = this.localeFileOf(document);
    if (rel === undefined) return;
    const pending = this.editTimers.get(rel);
    if (pending) clearTimeout(pending);
    this.editTimers.delete(rel);
    // Closed with unsaved edits: what is on disk is the truth again.
    this.queueUpdate(document.uri.fsPath);
  }

  private queueUpdate(fsPath: string): void {
    this.pendingPaths.add(fsPath);
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      const paths = [...this.pendingPaths];
      this.pendingPaths.clear();
      this.send({ type: 'update', paths });
    }, UPDATE_DEBOUNCE_MS);
  }

  private send(message: ToWorker): void {
    this.worker?.postMessage(message);
  }

  private onWorkerMessage(message: FromWorker): void {
    switch (message.type) {
      case 'loaded':
        this.index.replaceAll(message.records);
        this.log.appendLine(
          `[locale] ${this.index.size} keys in ${message.files} files (${this.index.locales().join(', ') || 'no locales'}) ` +
            `indexed in ${message.elapsedMs} ms`,
        );
        this.updateEmitter.fire();
        break;
      case 'updated': {
        if (!this.index.ready) break;
        let changed = false;
        for (const file of message.files) {
          // An open file with unsaved edits keeps its typed text.
          const open = vscode.workspace.textDocuments.find(
            (document) => document.isDirty && this.localeFileOf(document) === file.filePath,
          );
          const records = open ? collectLocRecords(open.getText(), file.filePath) : file.records;
          changed = this.index.updateFile(file.filePath, records) || changed;
        }
        if (changed) this.updateEmitter.fire();
        break;
      }
      case 'failed':
        this.log.appendLine(`[locale] Localization index failed: ${message.reason}`);
        break;
    }
  }

  dispose(): void {
    this.stop();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
