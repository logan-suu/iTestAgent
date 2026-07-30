/**
 * DeviceExplorer — orchestrates DeviceBackend exploration execution.
 *
 * Task 3.12: US-8.1 exploration path (no XCUITest).
 *
 * Flow:
 *   launch → UI tree → alert check → locate element → execute action → record step
 *
 * Each step is recorded as a structured RunStep via RunStepRecorder.
 * Element location uses ElementLocator's 5-level degradation strategy (AC4).
 * System alerts are detected and dismissed by SystemAlertHandler (AC2).
 *
 * AC1 compliance: all device interactions go through the pluggable
 * DeviceBackend interface via ToolDispatcher — no direct device control.
 */

import type { ArtifactRef, ArtifactStore, RunStep } from 'itestagent-contracts';
import { redactValue } from '../context-builder.js';
import { EvidenceCollector } from '../evidence/evidence-collector.js';
import { ElementLocator } from './element-locator.js';
import { RunStepRecorder } from './run-step-recorder.js';
import { SystemAlertHandler } from './system-alert-handler.js';
import type {
  ExplorationAction,
  ExplorationOptions,
  LocatorResult,
  SystemAlertResult,
} from './types.js';

// ─── ToolDispatcher Interface ───────────────────────────────────

/**
 * Minimal ToolDispatcher interface consumed by DeviceExplorer.
 * Matches the ToolDispatcher.dispatch() signature from itestagent-engine.
 */
export interface ExplorerToolDispatcher {
  dispatch(call: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{
    callId: string;
    status: 'ok' | 'error';
    output: unknown;
    artifacts?: ArtifactRef[];
  }>;
}

// ─── DeviceExplorer ─────────────────────────────────────────────

export class DeviceExplorer {
  private readonly options: Required<ExplorationOptions>;
  private readonly toolDispatcher: ExplorerToolDispatcher;
  private readonly locator: ElementLocator;
  private readonly alertHandler: SystemAlertHandler;
  private readonly recorder: RunStepRecorder;
  private readonly evidenceCollector: EvidenceCollector;
  private readonly artifactStore?: ArtifactStore;
  private callCounter = 0;

  constructor(
    toolDispatcher: ExplorerToolDispatcher,
    options: ExplorationOptions,
    artifactStore?: ArtifactStore,
  ) {
    this.toolDispatcher = toolDispatcher;
    this.options = {
      settleMs: 500,
      maxLocatorRetries: 1,
      backendName: 'appium',
      runDir: '',
      ...options,
    } as Required<ExplorationOptions>;
    this.locator = new ElementLocator();
    this.alertHandler = new SystemAlertHandler();
    this.recorder = new RunStepRecorder(this.options.backendName);
    this.evidenceCollector = new EvidenceCollector();
    this.artifactStore = artifactStore;
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Execute exploration actions on the target device.
   *
   * @param actions - Ordered list of exploration actions to execute
   * @returns Array of recorded RunStep entries
   */
  async explore(actions: ExplorationAction[]): Promise<RunStep[]> {
    // Launch the app first
    await this.executeLaunch();

    // Execute each action sequentially (per-device serial execution)
    for (const action of actions) {
      await this.executeAction(action);
      // Settle: wait for UI to stabilize after each action
      await this.sleep(this.options.settleMs);
    }

    return this.recorder.getSteps();
  }

  /**
   * Get the recorded steps (even if exploration hasn't finished).
   */
  getSteps(): RunStep[] {
    return this.recorder.getSteps();
  }

  /**
   * Reset the recorder for a new exploration run.
   */
  reset(): void {
    this.recorder.reset();
    this.callCounter = 0;
  }

  // ─── Private: Launch ────────────────────────────────────────

  private async executeLaunch(bundleIdOverride?: string): Promise<void> {
    const bundleId = bundleIdOverride ?? this.options.bundleId;
    const stepId = this.recorder.startStep('launch', bundleId);

    const result = await this.toolDispatcher.dispatch({
      id: this.nextCallId(),
      name: 'launch_app',
      arguments: {
        deviceId: this.options.deviceId,
        bundleId,
      },
    });

    if (result.status === 'ok') {
      this.recorder.completeStep(stepId, result.output);
    } else {
      await this.failStepWithEvidence(stepId, `Launch failed: ${JSON.stringify(result.output)}`);
    }
  }

  // ─── Private: Action Execution ──────────────────────────────

  private async executeAction(action: ExplorationAction): Promise<void> {
    await this.checkForAlerts();

    switch (action.action) {
      case 'tap':
        await this.executeTap(action);
        break;
      case 'swipe':
        await this.executeSwipe(action);
        break;
      case 'input':
        await this.executeInput(action);
        break;
      case 'screenshot':
        await this.executeScreenshot(action);
        break;
      case 'wait':
        await this.executeWait(action);
        break;
      case 'launch':
        await this.executeLaunch(action.bundleId);
        break;
    }
  }

  // ─── Private: Tap ───────────────────────────────────────────

  private async executeTap(action: ExplorationAction): Promise<void> {
    if (!action.target) {
      // No target specified — skip with degradation
      const stepId = this.recorder.startStep('tap', '(no target)');
      await this.failStepWithEvidence(stepId, 'No target specified for tap action');
      return;
    }

    // Get UI tree for element location
    const uiTree = await this.getUiTree();
    if (!uiTree) {
      const stepId = this.recorder.startStep('tap', action.target);
      await this.failStepWithEvidence(stepId, 'Failed to get UI tree — cannot locate element');
      return;
    }

    // Check for system alerts
    const alertResult = this.alertHandler.detectAndHandle(uiTree);
    let currentTree = uiTree;
    if (alertResult.detected) {
      await this.handleAlert(alertResult);
      currentTree = (await this.getUiTree()) ?? uiTree;
    }

    // Locate the target element
    const locatorResult = this.locator.locate(currentTree, action.target);

    if (!locatorResult.found && locatorResult.confidence === 'low') {
      // Even coordinate fallback "found" it — but with low confidence
      // For explicit not-found, we degrade
      const stepId = this.recorder.startStep('tap', action.target, locatorResult);
      await this.failStepWithEvidence(
        stepId,
        locatorResult.degradation ?? 'Element not found in UI tree',
      );
      return;
    }

    if (!locatorResult.element) {
      const stepId = this.recorder.startStep('tap', action.target, locatorResult);
      await this.failStepWithEvidence(stepId, 'Locator returned no element coordinates');
      return;
    }

    // Execute tap via ToolDispatcher
    const stepId = this.recorder.startStep('tap', action.target, locatorResult);
    const result = await this.toolDispatcher.dispatch({
      id: this.nextCallId(),
      name: 'tap',
      arguments: {
        deviceId: this.options.deviceId,
        x: locatorResult.element.x,
        y: locatorResult.element.y,
      },
    });

    if (result.status === 'ok') {
      // Take post-tap screenshot and link as artifact
      const screenshotArtifact = await this.takeScreenshot();
      const artifacts: string[] = [];
      if (screenshotArtifact) {
        artifacts.push(screenshotArtifact.id);
        this.recorder.addArtifact(stepId, screenshotArtifact.id);
      }
      this.recorder.completeStep(stepId, result.output, artifacts);
    } else {
      await this.failStepWithEvidence(stepId, `Tap failed: ${JSON.stringify(result.output)}`);
    }
  }

  // ─── Private: Swipe ─────────────────────────────────────────

  private async executeSwipe(action: ExplorationAction): Promise<void> {
    const direction = action.direction ?? 'down';
    const stepId = this.recorder.startStep('swipe', action.target ?? `swipe_${direction}`);

    // Default swipe geometry: center of screen, swipe half the height
    const { fromX, fromY, toX, toY } = this.swipeCoordinates(direction);

    const result = await this.toolDispatcher.dispatch({
      id: this.nextCallId(),
      name: 'swipe',
      arguments: {
        deviceId: this.options.deviceId,
        fromX,
        fromY,
        toX,
        toY,
        durationMs: 300,
      },
    });

    if (result.status === 'ok') {
      this.recorder.completeStep(stepId, {
        direction,
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY },
        result: result.output,
      });
    } else {
      await this.failStepWithEvidence(
        stepId,
        `Swipe ${direction} failed: ${JSON.stringify(result.output)}`,
      );
    }
  }

  // ─── Private: Input ─────────────────────────────────────────

  private async executeInput(action: ExplorationAction): Promise<void> {
    if (!action.text) {
      const stepId = this.recorder.startStep('input', action.target ?? '(no text)');
      await this.failStepWithEvidence(stepId, 'No text specified for input action');
      return;
    }

    const stepId = this.recorder.startStep('type_text', action.target ?? action.text);

    const result = await this.toolDispatcher.dispatch({
      id: this.nextCallId(),
      name: 'type_text',
      arguments: {
        deviceId: this.options.deviceId,
        text: action.text,
      },
    });

    if (result.status === 'ok') {
      this.recorder.completeStep(stepId, {
        text: action.text,
        result: result.output,
      });
    } else {
      await this.failStepWithEvidence(
        stepId,
        `Input "${action.text}" failed: ${JSON.stringify(result.output)}`,
      );
    }
  }

  // ─── Private: Screenshot ────────────────────────────────────

  private async executeScreenshot(action: ExplorationAction): Promise<void> {
    const stepId = this.recorder.startStep('screenshot', action.target ?? 'screenshot');

    const artifact = await this.takeScreenshot();
    if (artifact) {
      this.recorder.completeStep(stepId, { artifactId: artifact.id }, [artifact.id]);
    } else {
      await this.failStepWithEvidence(stepId, 'Screenshot failed — backend returned no artifact');
    }
  }

  // ─── Private: Helpers ───────────────────────────────────────

  /**
   * Get the current UI tree from the device via ToolDispatcher.
   */
  private async getUiTree(): Promise<string | null> {
    const result = await this.toolDispatcher.dispatch({
      id: this.nextCallId(),
      name: 'get_ui_tree',
      arguments: { deviceId: this.options.deviceId },
    });

    if (result.status === 'error') return null;

    const output = result.output as Record<string, unknown> | undefined;
    if (output && typeof output.raw === 'string') {
      return output.raw;
    }
    return null;
  }

  /**
   * Take a screenshot via ToolDispatcher.
   */
  private async takeScreenshot(): Promise<ArtifactRef | null> {
    const result = await this.toolDispatcher.dispatch({
      id: this.nextCallId(),
      name: 'screenshot',
      arguments: { deviceId: this.options.deviceId },
    });

    if (result.status === 'ok' && result.artifacts && result.artifacts.length > 0) {
      const firstArtifact = result.artifacts[0];
      if (firstArtifact) return firstArtifact;
    }

    // Check if the output itself is an ArtifactRef
    const output = result.output as Record<string, unknown> | undefined;
    if (output && typeof output.id === 'string' && typeof output.type === 'string') {
      return output as unknown as ArtifactRef;
    }

    return null;
  }

  /**
   * Collect evidence on step failure and record it.
   *
   * Task 4.1 AC1-AC2: Automatic evidence collection on failure,
   * linked to the specific run step.
   *
   * @param stepId - The failing step ID.
   * @param error - Error message.
   */
  private async failStepWithEvidence(stepId: string, error: string): Promise<void> {
    const redactedError = redactValue(error);
    this.recorder.failStep(stepId, redactedError);

    if (!this.artifactStore || !this.options.runDir) return;

    try {
      const summary = await this.evidenceCollector.collectOnFailure(this.artifactStore, {
        deviceId: this.options.deviceId,
        targetKind: this.options.targetKind,
        stepId,
        runDir: this.options.runDir,
        backendName: this.options.backendName,
        bundleId: this.options.bundleId,
        xcresultPath: this.options.xcresultPath,
        tracePath: this.options.tracePath,
        recordingActive: this.options.recordingActive,
        dsymPath: this.options.dsymPath,
      });

      for (const artifact of summary.artifacts) {
        this.recorder.addArtifact(stepId, artifact.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[DeviceExplorer] Evidence collection failed for step ${stepId}: ${redactValue(msg)}`,
      );
    }
  }

  /**
   * Handle a detected system alert by tapping the dismiss button.
   */
  private async handleAlert(_alert: SystemAlertResult): Promise<void> {
    const stepId = this.recorder.startStep('dismiss_alert', _alert.alertText ?? 'system_alert');

    const uiTree = await this.getUiTree();
    const dismissCoords = uiTree ? this.alertHandler.getDismissCoordinates(uiTree) : null;
    if (!dismissCoords) {
      await this.failStepWithEvidence(stepId, 'Could not compute dismiss coordinates for alert');
      return;
    }

    const result = await this.toolDispatcher.dispatch({
      id: this.nextCallId(),
      name: 'tap',
      arguments: {
        deviceId: this.options.deviceId,
        x: dismissCoords.x,
        y: dismissCoords.y,
      },
    });

    if (result.status === 'ok') {
      this.recorder.completeStep(stepId, result.output);
    } else {
      await this.failStepWithEvidence(
        stepId,
        `Alert dismiss failed: ${JSON.stringify(result.output)}`,
      );
    }
  }

  /**
   * Check for and dismiss system alerts before executing an action.
   * Applies to all action types — any action can encounter a system alert.
   */
  private async checkForAlerts(): Promise<void> {
    const uiTree = await this.getUiTree();
    if (!uiTree) return;

    const alertResult = this.alertHandler.detectAndHandle(uiTree);
    if (alertResult.detected) {
      await this.handleAlert(alertResult);
    }
  }

  /**
   * Execute a timed wait and record it as a RunStep.
   */
  private async executeWait(action: ExplorationAction): Promise<void> {
    const waitMs = action.waitMs ?? 1000;
    const stepId = this.recorder.startStep('wait', action.target ?? `wait_${waitMs}ms`);
    await this.sleep(waitMs);
    this.recorder.completeStep(stepId, { waitMs });
  }

  /**
   * Compute swipe coordinates for a given direction.
   * Uses center of screen with half-screen swipe.
   */
  private swipeCoordinates(direction: string): {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } {
    switch (direction) {
      case 'up':
        // Swipe up: from bottom to top (scrolls content down)
        return { fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 };
      case 'down':
        // Swipe down: from top to bottom (scrolls content up)
        return { fromX: 0.5, fromY: 0.3, toX: 0.5, toY: 0.7 };
      case 'left':
        return { fromX: 0.7, fromY: 0.5, toX: 0.3, toY: 0.5 };
      case 'right':
        return { fromX: 0.3, fromY: 0.5, toX: 0.7, toY: 0.5 };
      default:
        return { fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3 };
    }
  }

  private nextCallId(): string {
    this.callCounter += 1;
    return `explore_${this.callCounter}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
