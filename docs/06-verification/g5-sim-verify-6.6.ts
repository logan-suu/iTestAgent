import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppiumDeviceBackend } from 'itestagent-backends-device-appium';
import { createBackendToolDispatcher, runRealDeviceExploration } from 'itestagent-engine';
import { createArtifactStore } from 'itestagent-store';

const simulatorId = process.env.ITESTAGENT_SIMULATOR_ID;
if (!simulatorId) throw new Error('ITESTAGENT_SIMULATOR_ID is required');

const runDir = mkdtempSync(join(tmpdir(), 'itestagent-g5-sim-6-6-'));
mkdirSync(join(runDir, 'artifacts'), { recursive: true });
const assembly = createAppiumDeviceBackend({
  udid: simulatorId,
  targetKind: 'simulator',
  bundleId: 'com.apple.Preferences',
  deviceName: 'iPhone 16 Pro',
  platformVersion: '18.2',
  wdaLocalPort: 8300,
  mjpegServerPort: 9300,
});

try {
  const seen = new Set<string>();
  const artifactStore = createArtifactStore(join(runDir, 'artifacts'));
  const result = await runRealDeviceExploration({
    backend: assembly.backend,
    toolDispatcher: createBackendToolDispatcher(assembly.backend),
    artifactStore,
    runDir,
    runId: 'g5-sim-6-6',
    bundleId: 'com.apple.Preferences',
    deviceId: simulatorId,
    targetKind: 'simulator',
    dynamicActions: {
      cases: ['settings-root-checkpoint', 'settings-second-checkpoint'],
      maxStepsPerCase: 2,
      async suggest({ caseId, uiTree }) {
        if (uiTree.length === 0) throw new Error(`empty UI tree before ${caseId}`);
        if (seen.has(caseId)) return 'done';
        seen.add(caseId);
        return { action: 'screenshot', target: `checkpoint ${caseId}` };
      },
    },
    exploration: { settleMs: 200, backendName: 'appium-g5-sim' },
  });
  const uiTrees = await artifactStore.search('uitree');
  const caseSteps = result.steps.filter((step) => step.caseId);
  if (caseSteps.length !== 2) throw new Error(`expected 2 case steps, got ${caseSteps.length}`);
  if (uiTrees.length !== 2) throw new Error(`expected 2 UI-tree checkpoints, got ${uiTrees.length}`);
  if (uiTrees.some((artifact) => !artifact.relatedStep || !artifact.relatedCase)) {
    throw new Error('checkpoint artifact is missing relatedStep or relatedCase');
  }
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        targetKind: 'simulator',
        simulatorId,
        runDir,
        stepSequences: result.steps.map((step) => step.sequence),
        caseSteps: caseSteps.map((step) => ({
          caseId: step.caseId,
          status: step.status,
          artifactCount: step.artifacts.length,
        })),
        checkpoints: uiTrees.map((artifact) => ({
          relatedCase: artifact.relatedCase,
          relatedStep: artifact.relatedStep,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await assembly.backend.closeSession();
}
