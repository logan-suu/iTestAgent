/**
 * Replay assertion handlers — B08 module split (promotion guide §11.3 "Flow
 * replay/redaction"). Moved verbatim from the former replay.ts monolith's
 * executeStep switch.
 *
 * Assertion actions read device state and never mutate it. Like observation
 * actions they return their terminal ReplayStepResult directly — they never
 * fall through to post-step evidence collection.
 */
import type { UiTreeSnapshot } from 'itestagent-contracts';
import { extractElementText } from './replay-action-utils.js';
import { findElementInUiTree } from './replay-locator.js';
import { type ReplayStepResult, blockedStep, failedStep, passedStep } from './replay-result.js';
import type { StepHandlerContext } from './replay-types.js';
import type { FlowStepV2 } from './schema.js';

const ACTION_SET = new Set(['assertVisible', 'assertNotVisible', 'assertText']);

/** Whether an action belongs to the assertion group. */
export function isAssertionAction(action: string): boolean {
  return ACTION_SET.has(action);
}

/**
 * Executes one visibility/text assertion against the live UI tree.
 * Always returns a terminal ReplayStepResult.
 */
export async function runAssertionAction(
  action: string,
  step: FlowStepV2,
  stepIndex: number,
  target: string | undefined,
  ctx: StepHandlerContext,
  startTime: number,
): Promise<ReplayStepResult> {
  const { backend, deviceId, signal } = ctx;

  if (!step.locator) {
    return blockedStep(stepIndex, action, target, 'No locator provided for assertion.');
  }

  let uiTree: UiTreeSnapshot;
  try {
    uiTree = await backend.getUiTree({ deviceId }, signal);
  } catch {
    return failedStep(
      stepIndex,
      action,
      target,
      Date.now() - startTime,
      'Failed to get UI tree for assertion',
      [],
    );
  }

  const element = findElementInUiTree(uiTree.raw, step.locator);
  const duration = Date.now() - startTime;

  if (action === 'assertVisible') {
    if (element) {
      return passedStep(stepIndex, action, target, duration, [], 'Element is visible');
    }
    return failedStep(
      stepIndex,
      action,
      target,
      duration,
      `Element not visible: ${step.locator.strategy}="${step.locator.value}"`,
      [],
    );
  }

  if (action === 'assertNotVisible') {
    if (!element) {
      return passedStep(
        stepIndex,
        action,
        target,
        duration,
        [],
        'Element is not visible (as expected)',
      );
    }
    return failedStep(
      stepIndex,
      action,
      target,
      duration,
      `Element is visible but should not be: ${step.locator.strategy}="${step.locator.value}"`,
      [],
    );
  }

  if (action === 'assertText') {
    if (!element) {
      return failedStep(
        stepIndex,
        action,
        target,
        duration,
        `Element not found for text assertion: ${step.locator.strategy}="${step.locator.value}"`,
        [],
      );
    }
    // Check if element text matches expectedText
    const elementText = extractElementText(element, uiTree.raw);
    const expected = step.expectedText ?? '';
    if (elementText.includes(expected)) {
      return passedStep(stepIndex, action, target, duration, [], `Text matches: "${expected}"`);
    }
    return failedStep(
      stepIndex,
      action,
      target,
      duration,
      `Expected text "${expected}" not found. Actual element text: "${elementText}"`,
      [],
    );
  }

  // Unreachable via ACTION_SET guard; defensive fallback keeps the contract total.
  return blockedStep(
    stepIndex,
    action,
    target,
    `Unknown assertion action "${action}" — not supported for replay`,
  );
}
