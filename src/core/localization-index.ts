/**
 * The localization index: every Fluent message and term of every locale under
 * the fork's `Resources/Locale/<locale>/**` and the engine's
 * `RobustToolbox/Resources/Locale/<locale>/**`. It answers, for a LocId key,
 * what it reads as in a locale and where each locale declares it.
 *
 * Like the prototype index, records are grouped by file — the unit of
 * incremental update — and by id, the unit of lookup.
 */

import { flattenPattern, parseFluent, type FluentEntry, type FluentPosition } from './fluent';

/** Where `.ftl` files live, fork-relative; the first path segment below each is the locale. */
export const LOCALE_ROOTS = ['Resources/Locale', 'RobustToolbox/Resources/Locale'] as const;

/** The locale every key is written in first — the fallback for a display locale that lacks one. */
export const FALLBACK_LOCALE = 'en-US';

/** One message or term in one `.ftl` file. */
export interface LocRecord {
  readonly id: string;
  readonly locale: string;
  /** Fork-relative, `/`-separated. */
  readonly filePath: string;
  /** 0-based line of the id. */
  readonly line: number;
  readonly value: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  /** Where each attribute's `.name` is written. */
  readonly attributePositions: Readonly<Record<string, FluentPosition>>;
}

/** The locale a fork-relative `.ftl` path belongs to, or `null` outside every {@link LOCALE_ROOTS}. */
export function localeOf(filePath: string): string | null {
  for (const root of LOCALE_ROOTS) {
    if (!filePath.startsWith(`${root}/`)) continue;
    const rest = filePath.slice(root.length + 1);
    const slash = rest.indexOf('/');
    return slash > 0 ? rest.slice(0, slash) : null;
  }
  return null;
}

/** The records of one `.ftl` file's text; `[]` outside the locale roots. */
export function collectLocRecords(text: string, filePath: string): LocRecord[] {
  const locale = localeOf(filePath);
  if (locale === null) return [];
  return parseFluent(text).map((entry: FluentEntry) => ({
    id: entry.id,
    locale,
    filePath,
    line: entry.line,
    value: entry.value,
    attributes: entry.attributes,
    attributePositions: entry.attributePositions,
  }));
}

/** A key's text in one locale, and the record it is read from. */
export interface LocTranslation {
  readonly locale: string;
  readonly record: LocRecord;
  /** The pattern as one line (see {@link flattenPattern}). */
  readonly text: string;
}

/** The read side of {@link LocalizationIndex} — what the providers consume. */
export type LocalizationIndexView = Pick<
  LocalizationIndex,
  'ready' | 'has' | 'declarations' | 'translations' | 'preview'
>;

export class LocalizationIndex {
  private readonly byFile = new Map<string, readonly LocRecord[]>();
  private readonly byId = new Map<string, LocRecord[]>();
  private loaded = false;

  get ready(): boolean {
    return this.loaded;
  }

  get size(): number {
    return this.byId.size;
  }

  /** The locales that declare at least one key, sorted. */
  locales(): string[] {
    const locales = new Set<string>();
    for (const records of this.byFile.values()) for (const record of records) locales.add(record.locale);
    return [...locales].sort();
  }

  reset(): void {
    this.byFile.clear();
    this.byId.clear();
    this.loaded = false;
  }

  replaceAll(records: readonly LocRecord[]): void {
    this.byFile.clear();
    this.byId.clear();
    const grouped = new Map<string, LocRecord[]>();
    for (const record of records) {
      const list = grouped.get(record.filePath);
      if (list) list.push(record);
      else grouped.set(record.filePath, [record]);
    }
    for (const [filePath, list] of grouped) this.setFile(filePath, list);
    this.loaded = true;
  }

  /** Replace one file's records (`[]` for a deleted file). `true` when anything changed. */
  updateFile(filePath: string, records: readonly LocRecord[]): boolean {
    const before = this.byFile.get(filePath) ?? [];
    if (sameRecords(before, records)) return false;
    for (const record of before) {
      const list = this.byId.get(record.id);
      if (!list) continue;
      const remaining = list.filter((other) => other !== record);
      if (remaining.length > 0) this.byId.set(record.id, remaining);
      else this.byId.delete(record.id);
    }
    this.byFile.delete(filePath);
    if (records.length > 0) this.setFile(filePath, records);
    return true;
  }

  /** Whether any locale declares `key` (a message id, optionally `.attribute`). */
  has(key: string): boolean {
    return this.declarations(key).length > 0;
  }

  /**
   * Every record declaring `key`, ordered `displayLocale` first, then
   * {@link FALLBACK_LOCALE}, then the rest by locale and path. For `msg.attr`
   * only the records that carry the attribute.
   */
  declarations(key: string, displayLocale: string = FALLBACK_LOCALE): LocRecord[] {
    if (!this.loaded) return [];
    const { id, attribute } = splitKey(key);
    const records = (this.byId.get(id) ?? []).filter((record) =>
      attribute === null ? record.value !== null || Object.keys(record.attributes).length > 0 : Object.hasOwn(record.attributes, attribute),
    );
    const rank = (locale: string) => (locale === displayLocale ? 0 : locale === FALLBACK_LOCALE ? 1 : 2);
    return records.sort(
      (a, b) =>
        rank(a.locale) - rank(b.locale) ||
        compare(a.locale, b.locale) ||
        compare(a.filePath, b.filePath) ||
        a.line - b.line,
    );
  }

  /** `key` in every locale that declares it, in {@link declarations} order — one per locale. */
  translations(key: string, displayLocale: string = FALLBACK_LOCALE): LocTranslation[] {
    const seen = new Set<string>();
    const out: LocTranslation[] = [];
    for (const record of this.declarations(key, displayLocale)) {
      if (seen.has(record.locale)) continue;
      const pattern = patternOf(record, splitKey(key).attribute);
      if (pattern === null) continue;
      seen.add(record.locale);
      out.push({ locale: record.locale, record, text: flattenPattern(pattern, this.resolverFor(record.locale)) });
    }
    return out;
  }

  /**
   * The one-line text `key` folds into: its value in `displayLocale`, else in
   * {@link FALLBACK_LOCALE}; `null` when neither declares it.
   */
  preview(key: string, displayLocale: string = FALLBACK_LOCALE): string | null {
    const [first] = this.translations(key, displayLocale);
    return first && (first.locale === displayLocale || first.locale === FALLBACK_LOCALE) ? first.text : null;
  }

  /** Message/term references resolve in the same locale, falling back to {@link FALLBACK_LOCALE}. */
  private resolverFor(locale: string): (reference: string) => string | null {
    return (reference) => {
      const { id, attribute } = splitKey(reference);
      const candidates = this.byId.get(id) ?? [];
      for (const wanted of [locale, FALLBACK_LOCALE]) {
        for (const record of candidates) {
          if (record.locale !== wanted) continue;
          const pattern = patternOf(record, attribute);
          if (pattern !== null) return pattern;
        }
      }
      return null;
    };
  }

  private setFile(filePath: string, records: readonly LocRecord[]): void {
    this.byFile.set(filePath, records);
    for (const record of records) {
      const list = this.byId.get(record.id);
      if (list) list.push(record);
      else this.byId.set(record.id, [record]);
    }
  }
}

/**
 * Where `key` is written in `record`'s file: the message id at the start of
 * its line, or — for `msg.attr` — the attribute's `.attr`.
 */
export function declarationSpan(record: LocRecord, key: string): { line: number; column: number; length: number } {
  const { attribute } = splitKey(key);
  if (attribute !== null && Object.hasOwn(record.attributePositions, attribute)) {
    const { line, column } = record.attributePositions[attribute];
    return { line, column, length: attribute.length + 1 };
  }
  return { line: record.line, column: 0, length: record.id.length };
}

/** `msg.attr` -> `{ id: 'msg', attribute: 'attr' }`; a plain id has no attribute. */
function splitKey(key: string): { id: string; attribute: string | null } {
  const dot = key.indexOf('.');
  return dot === -1 ? { id: key, attribute: null } : { id: key.slice(0, dot), attribute: key.slice(dot + 1) };
}

function patternOf(record: LocRecord, attribute: string | null): string | null {
  if (attribute === null) return record.value;
  return Object.hasOwn(record.attributes, attribute) ? record.attributes[attribute] : null;
}

function sameRecords(a: readonly LocRecord[], b: readonly LocRecord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((record, i) => {
    const other = b[i];
    return (
      record.id === other.id &&
      record.line === other.line &&
      record.value === other.value &&
      JSON.stringify(record.attributes) === JSON.stringify(other.attributes) &&
      JSON.stringify(record.attributePositions) === JSON.stringify(other.attributePositions)
    );
  });
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The localization index's state, shaped like the prototype index's
 * `IndexStatus`: one `state` discriminant and a `message` to log verbatim.
 */
export type LocaleIndexStatus =
  | { readonly state: 'building'; readonly message: string }
  | { readonly state: 'ready'; readonly message: string; readonly keys: number }
  | { readonly state: 'failed'; readonly message: string };

export function localeIndexBuilding(): LocaleIndexStatus {
  return { state: 'building', message: 'Indexing localization…' };
}

export function localeIndexReady(keys: number, files: number, locales: readonly string[]): LocaleIndexStatus {
  return {
    state: 'ready',
    keys,
    message: `Localization index: ${keys} keys in ${files} files (${locales.join(', ') || 'no locales'}).`,
  };
}

export function localeIndexFailed(reason: string): LocaleIndexStatus {
  return { state: 'failed', message: `Localization index failed: ${reason}` };
}
