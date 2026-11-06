/**
 * Fluent (`.ftl`) reading for LocId previews. Pure core: file text in, entries
 * as plain data out, plus the one-line text a LocId key folds into.
 *
 * Only the slice of Fluent syntax a preview needs is read: messages (`key =`),
 * terms (`-key =`), their attributes (`.attr =`) and multiline continuation.
 * Comments and anything unrecognised at column 0 end the current entry. The
 * pattern text is kept as written; {@link flattenPattern} reduces it to one line:
 *
 *   - `{ $var }` stays a visible `{$var}` placeholder;
 *   - a function call is replaced by its first positional argument —
 *     `{ CAPITALIZE(THE($entity)) }` reads `{$entity}`;
 *   - a select expression `{ $n -> [one] … *[other] … }` reads its default variant;
 *   - a string literal reads its text;
 *   - a message or term reference is expanded through `resolve` (once —
 *     deeper references stay `{ref}`).
 */

/** One message or term of an `.ftl` file. */
export interface FluentEntry {
  /** As written — `-` included for a term. */
  readonly id: string;
  /** The value pattern, continuation lines joined with `\n`; `null` when the entry has only attributes. */
  readonly value: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  /** 0-based line of the id. */
  readonly line: number;
  /** Offset of the id in the (BOM-stripped) text. */
  readonly offset: number;
}

const ENTRY = /^(-?[a-zA-Z][a-zA-Z0-9_-]*)[ \t]*=[ \t]*(.*)$/;
const ATTRIBUTE = /^[ \t]+\.([a-zA-Z][a-zA-Z0-9_-]*)[ \t]*=[ \t]*(.*)$/;
const INDENTED = /^[ \t]+\S/;
const BLANK = /^[ \t]*$/;

/** Every message and term in `rawText`, in source order. */
export function parseFluent(rawText: string): FluentEntry[] {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const entries: FluentEntry[] = [];

  let current: { id: string; value: string[]; attributes: Record<string, string[]>; line: number; offset: number } | null =
    null;
  let target: string[] | null = null;

  const close = () => {
    if (!current) return;
    const value = joinLines(current.value);
    const attributes: Record<string, string> = {};
    for (const [name, lines] of Object.entries(current.attributes)) attributes[name] = joinLines(lines) ?? '';
    entries.push({ id: current.id, value, attributes, line: current.line, offset: current.offset });
    current = null;
    target = null;
  };

  let offset = 0;
  const lines = text.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line].endsWith('\r') ? lines[line].slice(0, -1) : lines[line];
    const lineStart = offset;
    offset += lines[line].length + 1;

    if (BLANK.test(raw)) continue;

    const entry = ENTRY.exec(raw);
    if (entry) {
      close();
      current = { id: entry[1], value: [], attributes: Object.create(null), line, offset: lineStart };
      target = current.value;
      if (entry[2]) target.push(entry[2]);
      continue;
    }

    if (current && INDENTED.test(raw)) {
      const attribute = ATTRIBUTE.exec(raw);
      if (attribute) {
        target = current.attributes[attribute[1]] = [];
        if (attribute[2]) target.push(attribute[2]);
      } else {
        target?.push(raw.trim());
      }
      continue;
    }

    // A comment, a junk line, or a stray indented line before any entry.
    close();
  }
  close();
  return entries;
}

function joinLines(lines: readonly string[]): string | null {
  return lines.length === 0 ? null : lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pattern -> one line
// ---------------------------------------------------------------------------

/** Looks up a referenced message (`msg`, `msg.attr`) or term (`-term`) pattern; `null` when unknown. */
export type FluentResolver = (reference: string) => string | null;

/** How many levels of message references are expanded. */
const MAX_REFERENCE_DEPTH = 1;

/**
 * The pattern as one line of text: placeables reduced (see the module doc),
 * whitespace — line breaks included — collapsed to single spaces.
 */
export function flattenPattern(pattern: string, resolve: FluentResolver = () => null): string {
  return flatten(pattern, resolve, 0).replace(/\s+/g, ' ').trim();
}

function flatten(pattern: string, resolve: FluentResolver, depth: number): string {
  let out = '';
  let at = 0;
  while (at < pattern.length) {
    const open = pattern.indexOf('{', at);
    if (open === -1) {
      out += pattern.slice(at);
      break;
    }
    out += pattern.slice(at, open);
    const close = matchingBrace(pattern, open);
    if (close === -1) {
      out += pattern.slice(open);
      break;
    }
    out += expression(pattern.slice(open + 1, close), resolve, depth);
    at = close + 1;
  }
  return out;
}

/** Index of the `}` closing the `{` at `open`, skipping nested braces and string literals; `-1` if none. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i = stringEnd(text, i);
      if (i === -1) return -1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Index of the `"` closing the string literal opened at `quote`; `-1` if unterminated. */
function stringEnd(text: string, quote: number): number {
  for (let i = quote + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i;
    else if (text[i] === '\n') return -1;
  }
  return -1;
}

const STRING_LITERAL = /^"((?:[^"\\]|\\.)*)"$/;
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;
const VARIABLE = /^\$([a-zA-Z][a-zA-Z0-9_-]*)$/;
const REFERENCE = /^(-?[a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*)?)\s*(\(.*\))?$/s;
const CALL = /^[A-Z][A-Z0-9_-]*\s*\((.*)\)$/s;

/** The text one placeable's inner expression reads as. */
function expression(inner: string, resolve: FluentResolver, depth: number): string {
  const arrow = topLevelArrow(inner);
  if (arrow !== -1) return flatten(defaultVariant(inner.slice(arrow + 2)), resolve, depth);

  const expr = inner.trim();
  if (expr.startsWith('{') && expr.endsWith('}')) return expression(expr.slice(1, -1), resolve, depth);

  const string = STRING_LITERAL.exec(expr);
  if (string) return unescape(string[1]);
  if (NUMBER_LITERAL.test(expr)) return expr;

  const variable = VARIABLE.exec(expr);
  if (variable) return `{$${variable[1]}}`;

  const call = CALL.exec(expr);
  if (call) {
    const first = firstPositionalArgument(call[1]);
    return first === null ? '' : expression(first, resolve, depth);
  }

  const reference = REFERENCE.exec(expr);
  if (reference) {
    const name = reference[1];
    const target = depth < MAX_REFERENCE_DEPTH ? resolve(name) : null;
    return target === null ? `{${name}}` : flatten(target, resolve, depth + 1);
  }

  return `{${expr}}`;
}

/** Index of a `->` outside any nested placeable or string; `-1` if none. */
function topLevelArrow(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      if (end === -1) return -1;
      i = end;
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && c === '-' && text[i + 1] === '>') return i;
  }
  return -1;
}

/** The default (`*[…]`) variant's pattern of a select expression's variant list — the first one if none is marked. */
function defaultVariant(variants: string): string {
  const starts: { at: number; bodyStart: number; isDefault: boolean }[] = [];
  let depth = 0;
  let lineStart = true;
  for (let i = 0; i < variants.length; i++) {
    const c = variants[i];
    if (c === '\n') {
      lineStart = true;
      continue;
    }
    if (depth === 0 && lineStart && (c === '[' || (c === '*' && variants[i + 1] === '['))) {
      const bracket = c === '*' ? i + 1 : i;
      const close = variants.indexOf(']', bracket);
      if (close !== -1) {
        starts.push({ at: i, bodyStart: close + 1, isDefault: c === '*' });
        i = close;
        lineStart = false;
        continue;
      }
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c !== ' ' && c !== '\t') lineStart = false;
  }
  if (starts.length === 0) return variants;
  const chosen = starts.findIndex((start) => start.isDefault);
  const index = chosen === -1 ? 0 : chosen;
  const end = index + 1 < starts.length ? starts[index + 1].at : variants.length;
  return variants.slice(starts[index].bodyStart, end);
}

/** The first argument of a call's argument list that is not `name: value`; `null` if there is none. */
function firstPositionalArgument(args: string): string | null {
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '"') {
      const end = stringEnd(args, i);
      if (end === -1) break;
      i = end;
    } else if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  const positional = parts.map((part) => part.trim()).find((part) => part && !/^[a-zA-Z][\w-]*\s*:/.test(part));
  return positional ?? null;
}

function unescape(text: string): string {
  return text.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{6}|.)/g, (_, escape: string) =>
    escape.length > 1 ? String.fromCodePoint(parseInt(escape.slice(1), 16)) : escape,
  );
}
