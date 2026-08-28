/**
 * xctrace-xml.test.ts — B12/B21 shared XML extraction helpers (promotion
 * guide §11.3 "generic xctrace mechanics").
 *
 * The xctrace parser family (toc/sysmon/export) builds on these primitives;
 * this suite locks their attribute-extraction and tag-scanning semantics.
 */
import { describe, expect, it } from 'bun:test';
import { extractAttribute, findOpeningTags } from '../src/xctrace-xml.js';

describe('extractAttribute', () => {
  it('extracts a named attribute from an opening-tag string', () => {
    const tag = '<frame name="fixture_frame_root" addr="0xF1X7URE0001" sampleCount="20">';
    expect(extractAttribute(tag, 'name')).toBe('fixture_frame_root');
    expect(extractAttribute(tag, 'addr')).toBe('0xF1X7URE0001');
    expect(extractAttribute(tag, 'sampleCount')).toBe('20');
  });

  it('returns null when the attribute is absent', () => {
    expect(extractAttribute('<row index="1">', 'value')).toBeNull();
  });
});

describe('findOpeningTags', () => {
  it('finds every opening tag of the given type in order', () => {
    const xml =
      '<trace><frame name="a" sampleCount="1"/><node><frame name="b" sampleCount="2"></frame></node></trace>';
    const tags = findOpeningTags(xml, 'frame');
    expect(tags).toHaveLength(2);
    expect(extractAttribute(tags[0] ?? '', 'name')).toBe('a');
    expect(extractAttribute(tags[1] ?? '', 'name')).toBe('b');
  });

  it('does not match closing or foreign tags', () => {
    const xml = '</frame><other/><frame name="only">';
    expect(findOpeningTags(xml, 'frame')).toHaveLength(1);
    expect(findOpeningTags(xml, 'other')).toHaveLength(1);
  });
});
