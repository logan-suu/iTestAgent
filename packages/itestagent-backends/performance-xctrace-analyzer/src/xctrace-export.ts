/**
 * Export-node extraction — B21 module split (promotion guide §11.3 "generic
 * xctrace mechanics").
 *
 * `xcrun xctrace export` emits XML whose tables are consumed
 * attribute-first. extractNodesByTag turns every opening tag of a given type
 * into a plain attribute dictionary so downstream parsers never touch raw
 * XML.
 */
import { findOpeningTags } from './xctrace-xml.js';

export interface XctraceExportNode {
  /** The scanned tag name (echoed for call-site readability). */
  tag: string;
  /** All attributes of the opening tag as a plain dictionary. */
  attrs: Record<string, string>;
}

/** Collects an attribute dictionary for every node of the given tag. */
export function extractNodesByTag(xml: string, tagName: string): XctraceExportNode[] {
  return findOpeningTags(xml, tagName).map((tag) => {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/\b([\w:-]+)="([^"]*)"/g)) {
      const key = match[1];
      const value = match[2];
      if (key !== undefined && value !== undefined) attrs[key] = value;
    }
    return { tag: tagName, attrs };
  });
}
