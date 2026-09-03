/**
 * Replay interaction handlers — B08 module split (promotion guide §11.3
 * "Flow replay/redaction"). Moved verbatim from the former replay.ts
 * monolith's executeStep switch.
 *
 * Interaction actions mutate device state (app lifecycle / touch / text /
 * navigation). They end with the monolith's post-step evidence collection,
 * so the dispatcher signals that via the INTERACTION_CONTINUE sentinel:
 * observation and assertion actions instead return their results directly.
 *
 * R5: missing locators/values block explicitly. R6: unresolved
 * session.secret.* references throw (caught by the dispatcher's caller).
 */
import type {
  ActionResult,
  LaunchAppInput,
  OpenUrlInput,
  PressButtonInput,
  SwipeInput,
  TapInput,
  TerminateAppInput,
  TypeTextInput,
} from 'itestagent-contracts';
import { directionToSwipePoints, normalizePressButton } from './replay-action-utils.js';
import { parseCoordinate, resolveTapCoordinates } from './replay-locator.js';
import { type ReplayStepResult, blockedStep } from './replay-result.js';
import type { StepHandlerContext } from './replay-types.js';
import type { FlowStepV2 } from './schema.js';

/** Sentinel: interaction handled with `break` → caller adds post-step evidence. */
export const INTERACTION_CONTINUE = Symbol('interaction-continue-post-evidence');

export type InteractionDispatchResult = ReplayStepResult | typeof INTERACTION_CONTINUE;

const ACTION_SET = new Set([
  'launchApp',
  'terminateApp',
  'tap',
  'longPress',
  'swipe',
  'typeText',
  'pressButton',
  'openUrl',
]);

/** Whether an action belongs to the interaction group. */
export function isInteractionAction(action: string): boolean {
  return ACTION_SET.has(action);
}

function requireActionSuccess(action: string, result: ActionResult): void {
  if (!result.success) {
    throw new Error(
      `${action} failed: ${result.error ?? result.message ?? 'backend returned failure'}`,
    );
  }
}

/**
 * Executes one interaction action against the device.
 * Returns INTERACTION_CONTINUE when the caller must append post-step
 * evidence; otherwise returns the terminal ReplayStepResult directly.
 */
export async function runInteractionAction(
  action: string,
  step: FlowStepV2,
  stepIndex: number,
  target: string | undefined,
  ctx: StepHandlerContext,
): Promise<InteractionDispatchResult> {
  const { backend, deviceId, bundleId, signal } = ctx;

  switch (action) {
    case 'launchApp': {
      const bid = (step.value as string | undefined) ?? bundleId;
      if (!bid) {
        return blockedStep(
          stepIndex,
          action,
          target,
          'No bundleId provided. Set --bundleId or include value in flow step.',
        );
      }
      requireActionSuccess(
        action,
        await backend.launchApp({ deviceId, bundleId: bid } as LaunchAppInput, signal),
      );
      break;
    }

    case 'terminateApp': {
      const bid = (step.value as string | undefined) ?? bundleId;
      if (!bid) {
        return blockedStep(stepIndex, action, target, 'No bundleId provided.');
      }
      requireActionSuccess(
        action,
        await backend.terminateApp({ deviceId, bundleId: bid } as TerminateAppInput, signal),
      );
      break;
    }

    case 'tap':
    case 'longPress': {
      if (!step.locator) {
        return blockedStep(
          stepIndex,
          action,
          target,
          'No locator provided for tap/longPress action.',
        );
      }
      const coords = await resolveTapCoordinates(step.locator, backend, deviceId, signal);
      if (!coords) {
        return blockedStep(
          stepIndex,
          action,
          target,
          `Locator resolution failed: strategy=${step.locator.strategy}, value="${step.locator.value}"`,
        );
      }
      requireActionSuccess(
        action,
        await backend.tap({ deviceId, x: coords.x, y: coords.y } as TapInput, signal),
      );
      break;
    }

    case 'swipe': {
      // Direction-based swipe
      if (step.direction) {
        const { fromX, fromY, toX, toY } = directionToSwipePoints(step.direction);
        requireActionSuccess(
          action,
          await backend.swipe(
            {
              deviceId,
              fromX,
              fromY,
              toX,
              toY,
              durationMs: step.durationMs,
            } as SwipeInput,
            signal,
          ),
        );
      } else if (step.locator?.strategy === 'coordinate') {
        // Coordinate-based swipe: locator value as "fromX,fromY→toX,toY" or "fromX,fromY"
        const parts = step.locator.value.split(/[→>]/);
        const fromPart = parts[0];
        if (!fromPart) {
          return blockedStep(
            stepIndex,
            action,
            target,
            `Cannot parse swipe coordinates from locator value: "${step.locator.value}"`,
          );
        }
        const fromCoord = parseCoordinate(fromPart);
        const toPart = parts[1];
        const toCoord = toPart ? parseCoordinate(toPart) : null;
        if (!fromCoord) {
          return blockedStep(
            stepIndex,
            action,
            target,
            `Cannot parse swipe coordinates from locator value: "${step.locator.value}"`,
          );
        }
        requireActionSuccess(
          action,
          await backend.swipe(
            {
              deviceId,
              fromX: fromCoord.x,
              fromY: fromCoord.y,
              toX: toCoord?.x ?? fromCoord.x,
              toY: toCoord?.y ?? fromCoord.y,
              durationMs: step.durationMs,
            } as SwipeInput,
            signal,
          ),
        );
      } else {
        return blockedStep(
          stepIndex,
          action,
          target,
          'Swipe step requires direction or coordinate locator.',
        );
      }
      break;
    }

    case 'typeText': {
      const text = step.valueRef
        ? await ctx.resolveValueRef?.(step.valueRef)
        : (step.value as string | undefined);
      if (text === undefined) {
        if (step.valueRef) {
          throw new Error(
            `R6: Unresolved value reference ${step.valueRef}. Provide an in-memory value resolver before replay.`,
          );
        }
        return blockedStep(
          stepIndex,
          action,
          target,
          'No text value provided for typeText action.',
        );
      }
      if (typeof text !== 'string' || text.length === 0) {
        return blockedStep(
          stepIndex,
          action,
          target,
          'typeText requires non-empty text; an empty string is a no-op.',
        );
      }
      requireActionSuccess(
        action,
        await backend.typeText({ deviceId, text } as TypeTextInput, signal),
      );
      break;
    }

    case 'pressButton': {
      const button = target ?? (step.value as string | undefined);
      if (!button) {
        return blockedStep(stepIndex, action, target, 'No button name provided.');
      }
      requireActionSuccess(
        action,
        await backend.pressButton(
          { deviceId, button: normalizePressButton(button) } as PressButtonInput,
          signal,
        ),
      );
      break;
    }

    case 'openUrl': {
      const url = (step.value as string | undefined) ?? target;
      if (!url) {
        return blockedStep(stepIndex, action, target, 'No URL provided.');
      }
      requireActionSuccess(
        action,
        await backend.openUrl({ deviceId, url } as OpenUrlInput, signal),
      );
      break;
    }

    default:
      return INTERACTION_CONTINUE;
  }

  return INTERACTION_CONTINUE;
}
