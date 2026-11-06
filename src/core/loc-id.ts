/**
 * LocId values in prototype YAML: which value under the caret, or which values
 * across a whole document, are localization keys — a slot the schema declares
 * `LocId` (`LocId?`, a list of them, a dictionary of them). Pure core: text +
 * schema in, spans out. The host folds these spans into their translation,
 * jumps from them to the `.ftl` declarations, and documents them on hover.
 */

import { contextAt, onLocIdSlot } from './completion';
import type { LocRecord, LocTranslation } from './localization-index';
import { parsePrototypeFile, valueScalarsOf, type PrototypeFile } from './prototype-yaml';
import type { SchemaRoot } from './schema-contract';

/** A LocId value as written. */
export interface LocIdSpan {
  /** `[start, end)` of the key text, quotes excluded. */
  readonly range: readonly [number, number];
  readonly key: string;
}

/** The LocId value the caret touches, or `null` off one (or when the file does not parse). */
export function locIdAt(text: string, offset: number, schema: SchemaRoot): LocIdSpan | null {
  const file = parsePrototypeFile(text);
  if (!file.ok) return null;
  const scalar = valueScalarsOf(file).find(({ range }) => offset >= range[0] && offset <= range[1]);
  if (!scalar || !isLocId(file, scalar.range[0], schema)) return null;
  return { range: scalar.range, key: scalar.value };
}

/**
 * Every LocId value in `text` that `known` accepts, in source order. `known` is
 * checked first — it is a map lookup, while telling a slot's type walks the
 * document — so values that are not keys at all cost almost nothing.
 */
export function locIdSpansIn(text: string, schema: SchemaRoot, known: (key: string) => boolean): LocIdSpan[] {
  const file = parsePrototypeFile(text);
  if (!file.ok) return [];
  return valueScalarsOf(file)
    .filter((scalar) => known(scalar.value) && isLocId(file, scalar.range[0], schema))
    .map((scalar) => ({ range: scalar.range, key: scalar.value }));
}

function isLocId(file: PrototypeFile, offset: number, schema: SchemaRoot): boolean {
  return onLocIdSlot(contextAt(file, offset, schema), schema);
}

/** Longest translation a hover shows in full. */
const MAX_HOVER_TEXT = 300;

/**
 * The hover for a LocId: the key, then each locale's text with a link to where
 * it is declared. `linkOf` turns a record into a link target (the host knows
 * the fork root). No translations at all reads as "not found".
 */
export function locHoverMarkdown(
  key: string,
  translations: readonly LocTranslation[],
  linkOf: (record: LocRecord) => string,
): string {
  const head = ['```fluent', key, '```'].join('\n');
  if (translations.length === 0) return `${head}\n\n*No translation found.*`;
  const lines = translations.map(({ locale, record, text }) => {
    const shown = text.length > MAX_HOVER_TEXT ? `${text.slice(0, MAX_HOVER_TEXT)}…` : text;
    const file = record.filePath.slice(record.filePath.lastIndexOf('/') + 1);
    return `- **${locale}**: ${escapeMarkdown(shown) || '*(empty)*'} — [${escapeMarkdown(file)}:${record.line + 1}](${linkOf(record)})`;
  });
  return `${head}\n\n${lines.join('\n')}`;
}

/** Longest folded preview; the rest is cut with `…`. */
export const MAX_PREVIEW_LENGTH = 60;

/** The text a LocId key folds into: quoted, cut to {@link MAX_PREVIEW_LENGTH}. */
export function foldedText(preview: string): string {
  const cut = preview.length > MAX_PREVIEW_LENGTH ? `${preview.slice(0, MAX_PREVIEW_LENGTH - 1)}…` : preview;
  return `"${cut}"`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&');
}
