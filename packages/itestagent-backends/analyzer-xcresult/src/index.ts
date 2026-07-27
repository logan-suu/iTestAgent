/**
 * Public exports for the xcresult parser adapter package.
 *
 * AGENTS.md R12: All code/comments in English.
 */

export { createXcresultParser } from './xcresult-parser.js';

export type {
  XcresultParserOptions,
  XcresultParseResult,
  SpawnAsyncFn,
  XcresultParserDeps,
} from './types.js';
