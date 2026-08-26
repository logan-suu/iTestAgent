/**
 * Report trio validation — B09 module split (promotion guide §11.3 "report
 * validation", §10 "dangling ref 校验").
 *
 * Pure functions over the parsed trio documents (result.json ↔
 * artifact-index.json): a result shipped with dangling artifactRefs — or an
 * index with duplicate ids — silently breaks auditability, so these checks
 * run before a trio is accepted.
 */
import type { ArtifactEntry } from './types.js';

export type ReportValidationIssueCode = 'dangling_artifact_ref' | 'duplicate_artifact_id';

export interface ReportValidationIssue {
  code: ReportValidationIssueCode;
  message: string;
}

/**
 * Returns an issue for every result artifactRef that does not resolve to an
 * entry in the artifact index.
 */
export function findDanglingArtifactRefs(
  artifactRefs: readonly string[],
  entries: ReadonlyArray<Pick<ArtifactEntry, 'id'>>,
): ReportValidationIssue[] {
  const known = new Set(entries.map((entry) => entry.id));
  const issues: ReportValidationIssue[] = [];
  for (const ref of artifactRefs) {
    if (!known.has(ref)) {
      issues.push({
        code: 'dangling_artifact_ref',
        message: `artifactRef "${ref}" not present in artifact-index`,
      });
    }
  }
  return issues;
}

/** Returns an issue for every id that appears more than once in the index. */
export function findDuplicateArtifactIds(
  entries: ReadonlyArray<Pick<ArtifactEntry, 'id'>>,
): ReportValidationIssue[] {
  const seen = new Set<string>();
  const issues: ReportValidationIssue[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push({
        code: 'duplicate_artifact_id',
        message: `duplicate artifact id "${entry.id}" in artifact-index`,
      });
    }
    seen.add(entry.id);
  }
  return issues;
}
