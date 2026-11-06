import * as fs from 'node:fs';
import * as path from 'node:path';
import { parentPort } from 'node:worker_threads';

import { collectLocRecords, LOCALE_ROOTS, type LocRecord } from '../core/localization-index';

/**
 * Worker thread behind the localization index: reads and parses every `.ftl`
 * file under the {@link LOCALE_ROOTS} (~2400 files, ~0.5 s on `crystall-edge`),
 * and re-reads the files a save, create or delete touched, so the Extension
 * Host thread never blocks on it. There is no on-disk cache — a cold build is
 * cheap enough.
 *
 * The host mirrors the records into its own `LocalizationIndex`. It reads only
 * the fork.
 */

export type ToWorker =
  | { readonly type: 'build'; readonly forkRoot: string }
  /** Absolute paths of files or folders that were saved, created or deleted. */
  | { readonly type: 'update'; readonly paths: readonly string[] };

export type FromWorker =
  | {
      readonly type: 'loaded';
      readonly records: readonly LocRecord[];
      readonly files: number;
      readonly elapsedMs: number;
    }
  /** Fresh records per touched file; `[]` for a file that was deleted. */
  | {
      readonly type: 'updated';
      readonly files: readonly { readonly filePath: string; readonly records: readonly LocRecord[] }[];
    }
  | { readonly type: 'failed'; readonly reason: string };

let forkRoot: string | undefined;
/** Fork-relative paths of every `.ftl` file read so far. */
const known = new Set<string>();

function post(message: FromWorker): void {
  parentPort?.postMessage(message);
}

function toRel(abs: string): string {
  return path.relative(forkRoot ?? '', abs).split(path.sep).join('/');
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.ftl')) out.push(abs);
  }
  return out;
}

function read(abs: string): LocRecord[] {
  try {
    return collectLocRecords(fs.readFileSync(abs, 'utf8'), toRel(abs));
  } catch {
    return [];
  }
}

function build(root: string): void {
  const started = Date.now();
  forkRoot = root;
  known.clear();
  const records: LocRecord[] = [];
  let files = 0;
  for (const dir of LOCALE_ROOTS) {
    for (const abs of walk(path.join(root, ...dir.split('/')))) {
      known.add(toRel(abs));
      records.push(...read(abs));
      files++;
    }
  }
  post({ type: 'loaded', records, files, elapsedMs: Date.now() - started });
}

function update(paths: readonly string[]): void {
  if (forkRoot === undefined) return;
  const touched = new Map<string, LocRecord[]>();
  for (const abs of paths) {
    const rel = toRel(abs);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(abs);
    } catch {
      stat = undefined;
    }
    if (stat?.isDirectory()) {
      for (const file of walk(abs)) {
        known.add(toRel(file));
        touched.set(toRel(file), read(file));
      }
    } else if (stat?.isFile()) {
      if (!rel.endsWith('.ftl')) continue;
      known.add(rel);
      touched.set(rel, read(abs));
    }
    // Gone — a file, or a folder whose files are reported only by its own path.
    if (!stat || stat.isDirectory()) {
      for (const file of [...known]) {
        if ((file === rel || file.startsWith(`${rel}/`)) && !touched.has(file) && !fs.existsSync(path.join(forkRoot, file))) {
          known.delete(file);
          touched.set(file, []);
        }
      }
    }
  }
  if (touched.size > 0) {
    post({ type: 'updated', files: [...touched].map(([filePath, records]) => ({ filePath, records })) });
  }
}

parentPort?.on('message', (message: ToWorker) => {
  try {
    if (message.type === 'build') build(message.forkRoot);
    else update(message.paths);
  } catch (err) {
    post({ type: 'failed', reason: err instanceof Error ? err.message : String(err) });
  }
});
