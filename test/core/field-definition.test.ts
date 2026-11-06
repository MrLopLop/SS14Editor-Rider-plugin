import { describe, expect, it } from 'vitest';

import { ClassLocator, memberDeclarationIn, type CsSourceTree } from '../../src/core/class-location';
import { classDefinitionAt, fieldDefinitionAt } from '../../src/core/definition';
import { parsedFixture, schemaSnapshot } from './prototype-fixtures';

/**
 * Go-to-definition from a prototype's `type:` to its `[Prototype]` class, and
 * from a field key to the C# member that declares it — in the class the schema
 * names as `declaringType`, a base class for an inherited field. The cursor half
 * reads the committed crystall-edge snapshot; the member search runs over
 * in-memory C# text.
 */
const SCHEMA = schemaSnapshot();

function tree(files: Record<string, string>): CsSourceTree {
  return {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readFile: (path) => Promise.resolve(files[path]),
  };
}

/** Offset `into` characters past the start of the first `needle` in `text`. */
function at(text: string, needle: string, into = 1): number {
  const index = text.indexOf(needle);
  if (index === -1) throw new Error(`"${needle}" not in text`);
  return index + into;
}

/** `[start, end)` of the first `needle` in `text`. */
function span(text: string, needle: string): [number, number] {
  const start = text.indexOf(needle);
  return [start, start + needle.length];
}

describe('memberDeclarationIn — a data-field member in one class body', () => {
  const TEXT = [
    'namespace Content.Shared.Foo;',
    '',
    '[RegisterComponent]',
    'public sealed partial class FooComponent : Component',
    '{',
    '    // public float Radius; in a comment',
    '    [DataField("label")] public string Text = "Radius;";',
    '    [DataField] public float Fallback = Radius;',
    '    [DataField] public float Radius = 5f;',
    '    [DataField] public string? Name { get; private set; }',
    '    [DataField] public Dictionary<string, int> Counts = new();',
    '    [DataField] public int[] Slots',
    '    {',
    '        get => _slots;',
    '    }',
    '    [DataField] private (int, int) _pair;',
    '    public float Scaled() => Radius * 2;',
    '',
    '    public sealed class Nested',
    '    {',
    '        public int Depth;',
    '    }',
    '    [DataField] public int Depth;',
    '}',
  ].join('\n');
  const CLASS = TEXT.indexOf('FooComponent');

  /** Offset of the declaration: the `needle` line, at `member`. */
  function declared(line: string, member: string): number {
    return TEXT.indexOf(line) + line.indexOf(member);
  }

  it.each([
    ['a field with an initializer, not its use in another one, a comment or a string', 'Radius', 'public float Radius = 5f;'],
    ['a nullable auto-property', 'Name', 'public string? Name {'],
    ['a field of a generic type', 'Counts', 'Dictionary<string, int> Counts'],
    ['a property whose body opens on the next line', 'Slots', 'public int[] Slots'],
    ['a field of a tuple type', '_pair', '(int, int) _pair'],
  ])('finds %s', (_what, member, line) => {
    expect(memberDeclarationIn(TEXT, CLASS, member)).toBe(declared(line, member));
  });

  it("skips a nested class's member of the same name", () => {
    expect(memberDeclarationIn(TEXT, CLASS, 'Depth')).toBe(declared('[DataField] public int Depth;', 'Depth'));
  });

  it('does not take a method for a member', () => {
    expect(memberDeclarationIn(TEXT, CLASS, 'Scaled')).toBeNull();
  });

  it('is null for a member the class does not declare', () => {
    expect(memberDeclarationIn(TEXT, CLASS, 'Missing')).toBeNull();
  });

  it('reads offsets into the BOM-stripped text', () => {
    expect(memberDeclarationIn(String.fromCharCode(0xfeff) + TEXT, CLASS, 'Radius')).toBe(
      declared('public float Radius = 5f;', 'Radius'),
    );
  });
});

describe('ClassLocator.locateMember — the member across the parts of its class', () => {
  const SHARED = 'Content.Shared/Foo/FooComponent.cs';
  const SHARED_TEXT = 'namespace Content.Shared.Foo;\npublic sealed partial class FooComponent\n{\n}\n';
  const SERVER = 'Content.Server/Foo/FooComponent.Server.cs';
  const SERVER_TEXT = [
    'namespace Content.Shared.Foo;',
    'public sealed partial class FooComponent',
    '{',
    '    [DataField] public float Radius;',
    '}',
  ].join('\n');
  const GENERIC = 'Content.Shared/Bar/BaseSensor.cs';
  const GENERIC_TEXT = [
    'namespace Content.Shared.Bar;',
    'public abstract partial class BaseSensor<T> where T : class',
    '{',
    '    [DataField] public T? Target;',
    '}',
  ].join('\n');
  const FILES = { [SHARED]: SHARED_TEXT, [SERVER]: SERVER_TEXT, [GENERIC]: GENERIC_TEXT };

  it('finds the member in whichever part declares it', async () => {
    const found = await new ClassLocator(tree(FILES)).locateMember('Content.Shared.Foo.FooComponent', 'Radius');

    expect(found).toEqual([{ filePath: SERVER, offset: SERVER_TEXT.indexOf('Radius'), name: 'Radius' }]);
  });

  it('finds the member of a generic class named with its arity', async () => {
    const found = await new ClassLocator(tree(FILES)).locateMember('Content.Shared.Bar.BaseSensor`1', 'Target');

    expect(found).toEqual([{ filePath: GENERIC, offset: GENERIC_TEXT.indexOf('Target'), name: 'Target' }]);
  });

  it('falls back to every part of the class when no part declares the member', async () => {
    const found = await new ClassLocator(tree(FILES)).locateMember('Content.Shared.Foo.FooComponent', 'Gone');

    expect(found).toEqual([
      { filePath: SHARED, offset: SHARED_TEXT.indexOf('FooComponent'), name: 'FooComponent' },
      { filePath: SERVER, offset: SERVER_TEXT.indexOf('FooComponent'), name: 'FooComponent' },
    ]);
  });

  it('is empty when the class is not in the sources', async () => {
    expect(await new ClassLocator(tree(FILES)).locateMember('Content.Shared.Nope.Nope', 'Radius')).toEqual([]);
  });
});

describe('classDefinitionAt — the prototype type under the caret', () => {
  const TEXT = ['- type: entity', '  id: Thing', '', '- type: noSuchPrototypeKind', '  id: Other', ''].join('\n');

  it("names the prototype's class and spans the written type", () => {
    expect(classDefinitionAt(TEXT, at(TEXT, 'entity', 2), SCHEMA)).toEqual({
      origin: span(TEXT, 'entity'),
      className: 'Robust.Shared.Prototypes.EntityPrototype',
      kind: 'prototype',
      name: 'entity',
    });
  });

  it('has no target for a type the schema does not know', () => {
    expect(classDefinitionAt(TEXT, at(TEXT, 'noSuchPrototypeKind'), SCHEMA)).toBeNull();
  });

  it('has no target on the `type` key itself', () => {
    expect(classDefinitionAt(TEXT, at(TEXT, 'type'), SCHEMA)).toBeNull();
  });
});

describe('fieldDefinitionAt — the field key under the caret', () => {
  const TEXT = [
    '- type: entity',
    '  id: Crate',
    '  name: crate',
    '  components:',
    '  - type: Damageable',
    '    damageModifierSet: Metallic',
    '    netsync: false',
    '    noSuchField: 1',
    '',
    '- type: damageModifierSet',
    '  id: M',
    '  coefficients:',
    '    Blunt: 0.5',
    '',
  ].join('\n');

  it("names a component field's member in the component's class", () => {
    expect(fieldDefinitionAt(TEXT, at(TEXT, 'damageModifierSet', 3), SCHEMA)).toEqual({
      origin: span(TEXT, 'damageModifierSet'),
      className: 'Content.Shared.Damage.Components.DamageableComponent',
      member: 'DamageModifierSetId',
    });
  });

  it('names an inherited field in the base class that declares it', () => {
    expect(fieldDefinitionAt(TEXT, at(TEXT, 'netsync'), SCHEMA)).toMatchObject({
      className: 'Robust.Shared.GameObjects.Component',
      member: '_netSync',
    });
  });

  it("names a prototype's own field", () => {
    expect(fieldDefinitionAt(TEXT, at(TEXT, 'name'), SCHEMA)).toMatchObject({
      className: 'Robust.Shared.Prototypes.EntityPrototype',
      member: 'SetName',
    });
  });

  it('names a field of the `[DataDefinition]` a `!type:` tag picks', () => {
    const claw = parsedFixture('claw.yml').text;

    expect(fieldDefinitionAt(claw, at(claw, 'arcWidth'), SCHEMA)).toMatchObject({
      origin: span(claw, 'arcWidth'),
      className: 'Content.Shared._CE.EntityEffect.Effects.WeaponArcAttack',
      member: expect.any(String),
    });
  });

  it.each([
    ['a key the schema has no field for', 'noSuchField'],
    ['a dictionary key', 'Blunt'],
    ['a field value', 'Metallic'],
    ['a component name', 'Damageable'],
  ])('has no target on %s', (_what, needle) => {
    expect(fieldDefinitionAt(TEXT, at(TEXT, needle), SCHEMA)).toBeNull();
  });

  it('has no target for a field the schema names no declaring class for', () => {
    const damageable = SCHEMA.components.Damageable;
    const schema = {
      ...SCHEMA,
      components: {
        ...SCHEMA.components,
        Damageable: { ...damageable, fields: damageable.fields.map((f) => ({ ...f, declaringType: undefined })) },
      },
    };

    expect(fieldDefinitionAt(TEXT, at(TEXT, 'damageModifierSet'), schema)).toBeNull();
  });
});
