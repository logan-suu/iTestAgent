/**
 * xctrace-export.test.ts — B21 export-node extraction (promotion guide §11.3
 * "generic xctrace mechanics").
 *
 * `xcrun xctrace export` emits XML whose tables are consumed attribute-first.
 * extractNodesByTag turns every opening tag of a given type into a plain
 * attribute dictionary so downstream parsers never touch raw XML.
 */
import { describe, expect, it } from 'bun:test';
import { extractNodesByTag } from '../src/xctrace-export.js';

describe('extractNodesByTag', () => {
  it('collects an attribute dictionary for every node of the tag', () => {
    const xml =
      '<table><row><attribute key="time" value="0.001"/><attribute key="value" value="12"/></row>' +
      '<row><attribute key="time" value="0.002"/><attribute key="value" value="14"/></row></table>';
    const nodes = extractNodesByTag(xml, 'attribute');
    expect(nodes).toHaveLength(4);
    expect(nodes[0]?.attrs).toEqual({ key: 'time', value: '0.001' });
    expect(nodes[3]?.attrs).toEqual({ key: 'value', value: '14' });
    for (const node of nodes) {
      expect(node.tag).toBe('attribute');
    }
  });

  it('returns an empty list when the tag is absent', () => {
    expect(extractNodesByTag('<table><row/></table>', 'attribute')).toEqual([]);
  });
});
