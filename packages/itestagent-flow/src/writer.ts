/**
 * Flow file writer — persists FlowV2 YAML to disk.
 *
 * Task 3.15: FlowV2 → YAML file persistence.
 * US-9.2 AC4: Flow default stored at ~/.itestagent/flows/;
 *   writing to project .itestagent/flows/ requires user confirmation (R7).
 *
 * Security: R7 — flow write to project directory requires user confirmation.
 * R6 — sensitive data never written to flow files (valueRef only).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FlowV2 } from './schema.js';
import { serializeFlowYaml } from './yaml.js';

// ─── Path Helpers ─────────────────────────────────────────────────

/**
 * Get the default flow directory: ~/.itestagent/flows/
 */
function getDefaultFlowDir(): string {
  return join(homedir(), '.itestagent', 'flows');
}

/**
 * Get the project-local flow directory: <projectPath>/.itestagent/flows/
 */
function getProjectFlowDir(projectPath: string): string {
  return join(projectPath, '.itestagent', 'flows');
}

// ─── Save Options ─────────────────────────────────────────────────

export interface SaveFlowOptions {
  /**
   * Optional project path. If provided, the flow is also written to
   * <projectPath>/.itestagent/flows/<flowId>.yaml (R7: requires user confirmation).
   */
  projectPath?: string;
  /**
   * Whether the user has confirmed writing to the project directory.
   * Required when projectPath is provided (R7).
   */
  projectConfirmed?: boolean;
}

export interface SaveFlowResult {
  /** Primary flow file path (always ~/.itestagent/flows/<flowId>.yaml) */
  defaultPath: string;
  /** Project-local flow file path (only if projectPath was provided and confirmed) */
  projectPath?: string;
  /** Whether the project write was performed */
  projectWritten: boolean;
  /** The flowId used for the filename */
  flowId: string;
}

// ─── Writer ───────────────────────────────────────────────────────

/**
 * Save a FlowV2 object as a YAML file.
 *
 * Always writes to ~/.itestagent/flows/<flowId>.yaml (US-9.2 AC4).
 * Optionally writes to <projectPath>/.itestagent/flows/<flowId>.yaml
 * when projectPath is provided AND confirmed (R7).
 *
 * US-9.2 AC4: Flow default stored at ~/.itestagent/flows;
 *   writing to project .itestagent/flows/ requires user confirmation.
 *
 * @param flow - The FlowV2 object to save
 * @param options - Save options (projectPath, projectConfirmed)
 * @returns Result with paths and confirmation status
 * @throws If projectPath is provided without projectConfirmed (R7 gate)
 */
export async function saveFlow(
  flow: FlowV2,
  options: SaveFlowOptions = {},
): Promise<SaveFlowResult> {
  const yamlContent = serializeFlowYaml(flow);
  const filename = `${flow.flowId}.yaml`;

  // Always write to default location
  const defaultDir = getDefaultFlowDir();
  await mkdir(defaultDir, { recursive: true });
  const defaultPath = join(defaultDir, filename);
  await writeFile(defaultPath, yamlContent, 'utf-8');

  const result: SaveFlowResult = {
    defaultPath,
    flowId: flow.flowId,
    projectWritten: false,
  };

  // Optional: write to project directory
  if (options.projectPath) {
    // R7: project write requires explicit user confirmation
    if (options.projectConfirmed !== true) {
      throw new Error(
        'R7: Writing flow to project directory (.itestagent/flows/) requires user confirmation. ' +
          'Set projectConfirmed: true to proceed, or omit projectPath to save only to ~/.itestagent/flows/.',
      );
    }

    const projectDir = getProjectFlowDir(options.projectPath);
    await mkdir(projectDir, { recursive: true });
    const projectFilePath = join(projectDir, filename);
    await writeFile(projectFilePath, yamlContent, 'utf-8');

    result.projectPath = projectFilePath;
    result.projectWritten = true;
  }

  return result;
}

/**
 * Read and parse a Flow YAML file by flowId.
 *
 * Looks up the flow in ~/.itestagent/flows/<flowId>.yaml.
 * Returns the raw parsed object (callers should validate with safeParseFlowV2).
 *
 * US-9.2 AC2: Supports itestagent run flow <flowId> replay.
 *
 * @param flowId - The flow identifier (matches the YAML filename)
 * @returns Parsed YAML content (unvalidated object)
 * @throws If the flow file does not exist or cannot be read
 */
export async function readFlowFile(flowId: string): Promise<unknown> {
  const { readFile } = await import('node:fs/promises');
  const flowPath = join(getDefaultFlowDir(), `${flowId}.yaml`);

  let content: string;
  try {
    content = await readFile(flowPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Flow "${flowId}" not found at ${flowPath}: ${message}`);
  }

  // Strip header comments before parsing YAML
  const yamlOnly = content
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  // Use dynamic import to avoid bundling yaml module for read-only use
  const { parse } = await import('yaml');
  return parse(yamlOnly);
}
