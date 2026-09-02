import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WdaManager } from 'itestagent-backends-device-appium';
import {
  createAppiumExplorationRuntime,
  createBackendToolDispatcher,
  runRealDeviceExploration,
} from 'itestagent-engine';
import { createArtifactStore } from 'itestagent-store';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function verifyMjpegStream(port: number): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('MJPEG verification timeout'), 10_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.toLowerCase().includes('multipart')) {
      throw new Error(`MJPEG endpoint is not a multipart stream: ${response.status} ${contentType}`);
    }
    const firstChunk = await response.body?.getReader().read();
    if (!firstChunk?.value?.byteLength) throw new Error('MJPEG stream returned no frame bytes');
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

const udid = requiredEnv('ITESTAGENT_PHYSICAL_UDID');
const coreDeviceId = requiredEnv('ITESTAGENT_CORE_DEVICE_ID');
const wdaProjectPath = requiredEnv('ITESTAGENT_WDA_PROJECT_PATH');
const teamId = requiredEnv('ITESTAGENT_WDA_TEAM_ID');
const wdaBundleId = requiredEnv('ITESTAGENT_WDA_BUNDLE_ID');
const platformVersion = requiredEnv('ITESTAGENT_PLATFORM_VERSION');
if (process.env.ITESTAGENT_CONFIRM_PREPARE_WDA?.trim() !== 'yes') {
  throw new Error('ITESTAGENT_CONFIRM_PREPARE_WDA=yes is required before preparing WDA');
}
const derivedDataPath = mkdtempSync(join(tmpdir(), 'itestagent-g5-physical-6-6-wda-'));
const runDir = mkdtempSync(join(tmpdir(), 'itestagent-g5-physical-6-6-run-'));
mkdirSync(join(runDir, 'artifacts'), { recursive: true });

const wda = new WdaManager({ stagingDir: join(runDir, 'wda-staging') });
let runtime: ReturnType<typeof createAppiumExplorationRuntime> | undefined;

try {
  const verification = await wda.preparePreinstalledWDA(
    {
      projectPath: wdaProjectPath,
      udid,
      teamId,
      codeSignIdentity: 'Apple Development',
      deploymentTarget: '17.0',
      derivedDataPath,
      productBundleIdentifier: wdaBundleId,
    },
    coreDeviceId,
    undefined,
    process.env.ITESTAGENT_CONFIRM_PREPARE_WDA === 'yes',
  );
  if (!verification.installed) {
    throw new Error(`WDA inventory verification failed: ${verification.reason ?? 'unknown'}`);
  }

  await wda.launch({
    projectPath: wdaProjectPath,
    udid,
    teamId,
    codeSignIdentity: 'Apple Development',
    deploymentTarget: '17.0',
    derivedDataPath,
    productBundleIdentifier: wdaBundleId,
    mjpegServerPort: 9200,
  });

  runtime = createAppiumExplorationRuntime({
    udid,
    bundleId: 'com.apple.Preferences',
    platformVersion,
    wdaStartupMode: 'external-url',
    webDriverAgentUrl: 'http://127.0.0.1:8200',
    wdaBundleId,
    wdaLocalPort: 8200,
    mjpegServerPort: 9200,
  });
  runtime.tunnel?.ensure({ udid, localPort: 8200, devicePort: 8100 });
  const wdaStatus = await wda.waitForReady(8200, 60_000);
  if (!wdaStatus.ready) throw new Error('WDA active readiness probe did not report ready');

  const seen = new Set<string>();
  const artifactStore = createArtifactStore(join(runDir, 'artifacts'));
  const result = await runRealDeviceExploration({
    backend: runtime.backend,
    toolDispatcher: createBackendToolDispatcher(runtime.backend),
    artifactStore,
    runDir,
    runId: 'g5-physical-6-6',
    bundleId: 'com.apple.Preferences',
    deviceId: udid,
    targetKind: 'physical',
    dynamicActions: {
      cases: ['settings-physical-first-checkpoint', 'settings-physical-second-checkpoint'],
      maxStepsPerCase: 2,
      async suggest({ caseId, uiTree }) {
        if (uiTree.length === 0) throw new Error(`empty UI tree before ${caseId}`);
        if (seen.has(caseId)) return 'done';
        seen.add(caseId);
        return { action: 'screenshot', target: `checkpoint ${caseId}` };
      },
    },
    exploration: { settleMs: 200, backendName: 'appium-g5-physical' },
  });
  await verifyMjpegStream(9200);

  const uiTrees = await artifactStore.search('uitree');
  const caseSteps = result.steps.filter((step) => step.caseId);
  if (caseSteps.length !== 2) throw new Error(`expected 2 case steps, got ${caseSteps.length}`);
  if (uiTrees.length !== 2) throw new Error(`expected 2 UI-tree checkpoints, got ${uiTrees.length}`);
  if (caseSteps.some((step) => step.status !== 'completed')) {
    throw new Error('one or more physical case steps did not complete');
  }
  if (uiTrees.some((artifact) => !artifact.relatedStep || !artifact.relatedCase)) {
    throw new Error('checkpoint artifact is missing relatedStep or relatedCase');
  }

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        targetKind: 'physical',
        runDir,
        wdaInstalledBundleId: verification.actualBundleId,
        wdaReadyWaitedMs: wdaStatus.waitedMs,
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
  await runtime?.close();
  await wda.stop();
}
