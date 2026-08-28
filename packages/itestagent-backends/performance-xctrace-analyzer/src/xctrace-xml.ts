/**
 * Shared XML extraction helpers — B21 module split (promotion guide §11.3
 * "generic xctrace mechanics").
 *
 * The xctrace parser family (toc / sysmon / export consumers) builds on these
 * attribute-extraction and tag-scanning primitives so raw regex handling
 * lives in exactly one place.
 */

/** Extracts a named attribute value from an opening-tag string, or null. */
export function extractAttribute(tagString: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tagString);
  return match?.[1] ?? null;
}

/** Returns every opening tag of the given type, in document order. */
export function findOpeningTags(xml: string, tagName: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}
