import { $ } from 'bun';

/**
 * computeProjectHash — deterministic project identifier.
 *
 * Computes sha256(workspace path + git HEAD) as a 64-character hex string.
 * If git is unavailable (no git repo), falls back to sha256(workspace path).
 *
 * Schema: project-profile.schema.json §projectHash — pattern ^[a-f0-9]{64}$
 */
export async function computeProjectHash(root: string): Promise<string> {
  let gitHead = '';

  try {
    // Try to get the current git HEAD for stronger determinism
    const result = await $`git -C ${root} rev-parse HEAD`.quiet();
    gitHead = result.text().trim();
  } catch {
    // No git repo — fall back to workspace path only
  }

  const input = gitHead ? `${root}:${gitHead}` : root;
  const hash = new Bun.CryptoHasher('sha256').update(input).digest('hex');

  return hash;
}
