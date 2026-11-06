/**
 * Go-to-definition for prototype ids (spec #20, "Текстовые провайдеры";
 * issue #33). Pure core: text + offset + schema snapshot + prototype index in,
 * the declaration to jump to as data out. The host adapter
 * ({@link file://../host/text-providers.ts}) turns it into a `LocationLink`;
 * VS Code then serves it on both Ctrl+Click and F12.
 *
 * The caret must sit on the value of a field that names a prototype — the same
 * question autocomplete asks ({@link protoRefKindAt}): `parent:` (scalar, block
 * list or flow list), `ProtoId<T>`, `EntProtoId`, and lists of them — or on a
 * key of a dictionary keyed by one (`damage.types: { Blunt: 5 }`). The id is
 * looked up under that field's kind only, so an entity id written in a reagent
 * field has no target.
 */

import { contextAt, fieldAt, protoRefKindAt, typeTagMemberAt } from './completion';
import type { PrototypeIndexView, PrototypeRecord } from './prototype-index';
import { parsePrototypeFile, type CursorContext, type PrototypeFile } from './prototype-yaml';
import type { SchemaRoot } from './schema-contract';

/** Where to jump, and which text it was asked from. */
export interface DefinitionTarget {
  /** `[start, end)` of the id under the caret — the link the editor underlines. */
  readonly origin: readonly [number, number];
  /** The index record of the declaration: fork-relative `filePath` plus its `range`. */
  readonly target: PrototypeRecord;
}

/**
 * The declaration of the prototype id at `offset` in `text`. `null` when the
 * index is not ready, the caret is not on a prototype-id value, or the index
 * holds no prototype of that kind and id.
 */
export function definitionAt(
  text: string,
  offset: number,
  schema: SchemaRoot,
  index: PrototypeIndexView,
): DefinitionTarget | null {
  if (!index.ready) return null;

  const file = parsePrototypeFile(text);
  if (!file.ok) return null;

  const kind = protoRefKindAt(contextAt(file, offset, schema), schema);
  if (kind === null) return null;

  const origin = idSpanAt(file.text, offset);
  if (!origin) return null;

  const lookup = index.get(kind, file.text.slice(origin[0], origin[1]));
  return lookup.ready && lookup.record ? { origin, target: lookup.record } : null;
}

/** A C# class to jump to, and which text it was asked from. */
export interface ClassDefinition {
  /** `[start, end)` of the name under the caret — a component name, a tag's member name, or a prototype type. */
  readonly origin: readonly [number, number];
  /** The class's full C# name, from the schema — for `ClassLocator.locate`. */
  readonly className: string;
  /** What names it: a component's `type:` value, a `!type:` tag, or a prototype's own `type:` value. */
  readonly kind: 'component' | 'type' | 'prototype';
  /** The name as written — a component's registration name, a tag's member name, a prototype type. */
  readonly name: string;
}

/**
 * The C# class named under the caret (issue #31): a component — the value of a
 * component-registry entry's `type:` — the union member a `!type:` tag picks,
 * or the `[Prototype]` class a prototype's own top-level `type:` names.
 * `null` off all three, or for a name the schema does not know there. Where that
 * class is declared is the `ClassLocator`'s question (./class-location.ts),
 * asked by the host.
 */
export function classDefinitionAt(text: string, offset: number, schema: SchemaRoot): ClassDefinition | null {
  const file = parsePrototypeFile(text);
  return file.ok ? classAt(file, contextAt(file, offset, schema), offset, schema) : null;
}

/**
 * {@link classDefinitionAt} over an already-read cursor context — for hover
 * (issue #30), which asks the same context about fields too.
 */
export function classAt(
  file: PrototypeFile,
  ctx: CursorContext,
  offset: number,
  schema: SchemaRoot,
): ClassDefinition | null {
  const { token } = ctx;

  if (token.kind === 'type-tag') {
    const member = typeTagMemberAt(ctx, schema);
    if (!member || token.text === null) return null;
    // The name ends the tag: `!type:<name>`.
    const end = token.range[1];
    return { origin: [end - token.text.length, end], className: member, kind: 'type', name: token.text };
  }

  if (isPrototypeTypeValue(ctx)) {
    const origin = idSpanAt(file.text, offset);
    const type = ctx.prototypeType;
    if (!origin || type === null || file.text.slice(origin[0], origin[1]) !== type) return null;
    const prototype = Object.hasOwn(schema.prototypes, type) ? schema.prototypes[type] : undefined;
    return prototype ? { origin, className: prototype.className, kind: 'prototype', name: type } : null;
  }

  if (token.kind !== 'component-type' || token.text === null) return null;
  const component = Object.hasOwn(schema.components, token.text) ? schema.components[token.text] : undefined;
  if (!component) return null;

  const origin = idSpanAt(file.text, offset);
  return origin ? { origin, className: component.className, kind: 'component', name: token.text } : null;
}

/** On the value of a prototype map's own `type:` — outside every component. */
function isPrototypeTypeValue(ctx: CursorContext): boolean {
  return (
    ctx.token.kind === 'value' &&
    ctx.component === null &&
    ctx.fieldPath.length === 1 &&
    ctx.fieldPath[0] === 'type'
  );
}

/** A C# member to jump to, and which text it was asked from. */
export interface FieldDefinition {
  /** `[start, end)` of the field key under the caret. */
  readonly origin: readonly [number, number];
  /** Full C# name of the class declaring the member — for `ClassLocator.locateMember`. */
  readonly className: string;
  /** The member's C# name. */
  readonly member: string;
}

/**
 * The C# member behind the field key under the caret — of a prototype, a
 * component, or a `[DataDefinition]` (through any `!type:` on the way); the
 * keys hover documents. The class is the one that declares the member, which
 * for an inherited field is a base class. `null` off a field key, or when the
 * schema does not name the declaring class (a document before schema v2).
 */
export function fieldDefinitionAt(text: string, offset: number, schema: SchemaRoot): FieldDefinition | null {
  const file = parsePrototypeFile(text);
  if (!file.ok) return null;

  const field = fieldAt(contextAt(file, offset, schema), schema);
  if (!field?.declaringType) return null;
  const origin = idSpanAt(file.text, offset);
  return origin ? { origin, className: field.declaringType, member: field.name } : null;
}

/**
 * A character that can be part of an id as written in YAML: anything but
 * whitespace, the flow-collection punctuation, quotes, `:` and `#`. That spans
 * one plain or quoted id, and one item of `[A, B]`.
 */
const ID_CHAR = /[^\s,[\]{}:#'"]/;

/** The run of {@link ID_CHAR}s the caret touches, or `null` when it touches none. */
export function idSpanAt(text: string, offset: number): [number, number] | null {
  let start = offset;
  while (start > 0 && ID_CHAR.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && ID_CHAR.test(text[end])) end++;
  return start === end ? null : [start, end];
}
