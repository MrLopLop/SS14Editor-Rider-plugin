import { describe, expect, it } from 'vitest';

import { flattenPattern, parseFluent } from '../../src/core/fluent';

describe('parseFluent', () => {
  it('reads messages, terms, attributes and continuation lines', () => {
    const text = [
      '# a comment',
      'ent-Crate = crate',
      '    .desc = A box.',
      '    .suffix = { "" }',
      '',
      '-brand = Nanotrasen',
      'multi =',
      '    first line',
      '    second line',
      'tail = end',
      '',
    ].join('\n');
    const entries = parseFluent(text);
    expect(entries.map((entry) => entry.id)).toEqual(['ent-Crate', '-brand', 'multi', 'tail']);
    expect(entries[0]).toMatchObject({ value: 'crate', line: 1, offset: text.indexOf('ent-Crate') });
    expect(entries[0].attributes).toEqual({ desc: 'A box.', suffix: '{ "" }' });
    expect(entries[2].value).toBe('first line\nsecond line');
    expect(entries[3].line).toBe(9);
  });

  it('handles CRLF and a BOM', () => {
    const entries = parseFluent('﻿a = one\r\n    .b = two\r\nc = three\r\n');
    expect(entries).toEqual([
      { id: 'a', value: 'one', attributes: { b: 'two' }, line: 0, offset: 0 },
      { id: 'c', value: 'three', attributes: {}, line: 2, offset: 23 },
    ]);
  });

  it('keeps an attribute-only message with a null value', () => {
    const [entry] = parseFluent('ent-X =\n    .desc = text\n');
    expect(entry.value).toBeNull();
    expect(entry.attributes).toEqual({ desc: 'text' });
  });

  it('ends an entry at a comment', () => {
    const entries = parseFluent('a = one\n# note\n    stray\nb = two\n');
    expect(entries.map((entry) => [entry.id, entry.value])).toEqual([
      ['a', 'one'],
      ['b', 'two'],
    ]);
  });
});

describe('flattenPattern', () => {
  it('keeps variables as placeholders', () => {
    expect(flattenPattern('Hello, { $name }!')).toBe('Hello, {$name}!');
  });

  it('replaces a function call with its first positional argument', () => {
    expect(flattenPattern('{CAPITALIZE(THE($entity))} digs its tentacles under the ground!')).toBe(
      '{$entity} digs its tentacles under the ground!',
    );
    expect(flattenPattern('{NATURALFIXED($percent, 0)}% served')).toBe('{$percent}% served');
    expect(flattenPattern('{ GENDER($ent, case: "nom") }')).toBe('{$ent}');
  });

  it('reads the default variant of a select expression', () => {
    const pattern = [
      '{ $number ->',
      '[0] Nothing.',
      '[one] Gained one access from {THE($card)}.',
      '*[other] Gained {$number} accesses.',
      '}',
    ].join('\n');
    expect(flattenPattern(pattern)).toBe('Gained {$number} accesses.');
  });

  it('reads the first variant when none is marked default', () => {
    expect(flattenPattern('{ $n -> [one] single\n[other] many }')).toBe('single');
  });

  it('reads string and number literals', () => {
    expect(flattenPattern('{ "" }')).toBe('');
    expect(flattenPattern('{ "quoted \\" text" } and { 5 }')).toBe('quoted " text and 5');
  });

  it('expands references one level deep', () => {
    const patterns: Record<string, string> = { '-brand': 'Nano{ -suffix }', '-suffix': 'trasen', msg: 'Hi', 'msg.attr': 'attr' };
    const resolve = (reference: string) => patterns[reference] ?? null;
    expect(flattenPattern('Made by { -brand }.', resolve)).toBe('Made by Nano{-suffix}.');
    expect(flattenPattern('{ msg } { msg.attr } { missing }', resolve)).toBe('Hi attr {missing}');
  });

  it('collapses line breaks and runs of whitespace', () => {
    expect(flattenPattern('first\n   second\t\tthird  ')).toBe('first second third');
  });
});
