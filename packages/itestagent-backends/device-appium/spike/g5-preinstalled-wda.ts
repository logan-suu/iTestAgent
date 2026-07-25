/**
 * G5 Spike: Route A (usePreinstalledWDA) + Route B (webDriverAgentUrl) verification.
 *
 * Prerequisites:
 *   1. iPhone connected via USB, trusted, Developer Mode ON
 *   2. Appium installed at ~/.appium/
 *   3. Free Apple Developer account (Personal Team) signed into Xcode
 *
 * Usage: bun run packages/itestagent-backends/device-appium/spike/g5-preinstalled-wda.ts
 */
import { WdaManager } from '../src/wda-manager.js';
import { AppiumDeviceBackend } from '../src/appium-device-backend.js';
import { RealAppiumDriver } from '../src/real-appium-driver.js';
import type { AppiumW3CCapabilities } from '../src/appium-driver.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── Configuration ──────────────────────────────────────────────────

const UDID = '00008110-0012690901C1401E';
const CORE_DEVICE_ID = 'F7C1CF80-8A2C-5AFB-85FE-C959DC4EC1F9';
const TEAM_ID = 'UJ876FXT32';
const WDA_BASE_BUNDLE_ID = 'UJ876FXT32.WebDriverAgentRunner'; // NO .xctrunner suffix
const WDA_PROJECT_PATH =
  '/Users/logansu/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent';
const WDA_PORT = 8100;
const APPIUM_PORT = 4723;
const TEST_BUNDLE_ID = 'com.apple.Preferences'; // Settings app

const EVIDENCE_DIR = join(import.meta.dirname ?? '.', '..', '..', 'spike-evidence', `g5-${Date.now()}`);

// ─── Helpers ────────────────────────────────────────────────────────

function log(section: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${section}] ${msg}`);
}

function saveEvidence(filename: string, content: string | Buffer): string {
  if (!existsSync(EVIDENCE_DIR)) {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const path = join(EVIDENCE_DIR, filename);
  writeFileSync(path, content);
  return path;
}

// ─── Gate 1: Prepare WDA ────────────────────────────────────────────

async function prepareWda(): Promise<{ installed: boolean; bundleId: string }> {
  const wdaManager = new WdaManager();

  log('WDA', `Building WDA for device ${UDID}...`);
  const buildResult = await wdaManager.build({
    projectPath: WDA_PROJECT_PATH,
    udid: UDID,
    teamId: TEAM_ID,
    productBundleIdentifier: WDA_BASE_BUNDLE_ID,
  });
  log('WDA', `Build SUCCESS. App: ${buildResult.appPath}`);
  log('WDA', `Bundle ID: ${buildResult.bundleId}`);

  log('WDA', `Installing WDA to device ${CORE_DEVICE_ID}...`);
  const installResult = await wdaManager.install({
    deviceId: CORE_DEVICE_ID,
    appPath: buildResult.appPath,
  });
  log('WDA', `Install SUCCESS. Bundle ID: ${installResult.bundleId}`);

  log('WDA', `Verifying preinstalled WDA...`);
  const verify = await wdaManager.verifyPreinstalledWDA(UDID, buildResult.bundleId);
  log('WDA', `Verification: ready=${verify.ready} ${verify.reason ? `(${verify.reason})` : ''}`);

  return { installed: verify.ready, bundleId: installResult.bundleId };
}

// ─── Gate 2: Route B (external-url) ─────────────────────────────────

async function testRouteB_ExternalUrl(): Promise<boolean> {
  log('RouteB', 'Starting Appium server...');
  const appiumProc = Bun.spawn(
    ['~/.appium/node_modules/.bin/appium', '-p', String(APPIUM_PORT), '--log-level', 'info'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  // Wait for Appium to be ready
  log('RouteB', 'Waiting for Appium server...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    const wdaManager = new WdaManager();

    // Launch WDA
    log('RouteB', 'Launching WDA via WdaManager...');
    const launchResult = await wdaManager.launch({
      projectPath: WDA_PROJECT_PATH,
      udid: UDID,
      wdaPort: WDA_PORT,
    });
    log('RouteB', `WDA launched. PID exists=${!!launchResult.process.pid}`);

    // Wait for WDA ready
    log('RouteB', `Waiting for WDA /status on port ${WDA_PORT}...`);
    const status = await wdaManager.waitForReady(WDA_PORT, 120000);
    log('RouteB', `WDA ready: ${status.ready} (waited ${status.waitedMs}ms)`);

    if (!status.ready) {
      log('RouteB', 'FAIL: WDA did not become ready');
      return false;
    }

    // Create Appium session with webDriverAgentUrl
    const realDriver = new RealAppiumDriver(APPIUM_PORT);
    const backend = new AppiumDeviceBackend(realDriver, {
      udid: UDID,
      targetKind: 'physical',
      bundleId: TEST_BUNDLE_ID,
      wdaStartupMode: 'external-url',
      webDriverAgentUrl: `http://127.0.0.1:${WDA_PORT}`,
    });

    // Test screenshot
    log('RouteB', 'Taking screenshot...');
    const screenshot = await backend.screenshot({});
    log('RouteB', `Screenshot: ${screenshot.path} (id=${screenshot.id})`);

    // Test UI tree
    log('RouteB', 'Getting UI tree...');
    const uiTree = await backend.getUiTree({ udid: UDID, targetKind: 'physical' });
    const treeLen = uiTree.raw?.length ?? 0;
    log('RouteB', `UI tree: ${treeLen} chars`);
    saveEvidence('routeb-ui-tree.xml', uiTree.raw ?? '');

    // Test tap (center of screen)
    log('RouteB', 'Tapping center of screen...');
    const tapResult = await backend.tap({ x: 0.5, y: 0.5 });
    log('RouteB', `Tap: ${tapResult.success} ${tapResult.error ?? ''}`);

    // Cleanup
    log('RouteB', 'Closing session...');
    await backend.closeSession();
    await wdaManager.stop(5000);

    log('RouteB', 'PASS');
    return true;
  } catch (err) {
    log('RouteB', `FAIL: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    appiumProc.kill();
    try {
      await appiumProc.exited;
    } catch {
      // best-effort
    }
  }
}

// ─── Gate 3: Route A (preinstalled) ─────────────────────────────────

async function testRouteA_Preinstalled(): Promise<boolean> {
  log('RouteA', 'Starting Appium server...');
  const appiumProc = Bun.spawn(
    ['~/.appium/node_modules/.bin/appium', '-p', String(APPIUM_PORT), '--log-level', 'info'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  log('RouteA', 'Waiting for Appium server...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    const realDriver = new RealAppiumDriver(APPIUM_PORT);
    const backend = new AppiumDeviceBackend(realDriver, {
      udid: UDID,
      targetKind: 'physical',
      bundleId: TEST_BUNDLE_ID,
      wdaStartupMode: 'preinstalled',
      wdaBundleId: WDA_BASE_BUNDLE_ID,
    });

    // Test screenshot
    log('RouteA', 'Taking screenshot (this triggers session creation)...');
    const screenshot = await backend.screenshot({});
    log('RouteA', `Screenshot: ${screenshot.path} (id=${screenshot.id})`);

    // Test UI tree
    log('RouteA', 'Getting UI tree...');
    const uiTree = await backend.getUiTree({ udid: UDID, targetKind: 'physical' });
    const treeLen = uiTree.raw?.length ?? 0;
    log('RouteA', `UI tree: ${treeLen} chars`);
    saveEvidence('routea-ui-tree.xml', uiTree.raw ?? '');

    // Test tap
    log('RouteA', 'Tapping center of screen...');
    const tapResult = await backend.tap({ x: 0.5, y: 0.5 });
    log('RouteA', `Tap: ${tapResult.success} ${tapResult.error ?? ''}`);

    // Test swipe
    log('RouteA', 'Swiping...');
    const swipeResult = await backend.swipe({ fromX: 0.5, fromY: 0.7, toX: 0.5, toY: 0.3, durationMs: 300 });
    log('RouteA', `Swipe: ${swipeResult.success} ${swipeResult.error ?? ''}`);

    // Cleanup
    log('RouteA', 'Closing session...');
    await backend.closeSession();

    log('RouteA', 'PASS');
    return true;
  } catch (err) {
    log('RouteA', `FAIL: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    appiumProc.kill();
    try {
      await appiumProc.exited;
    } catch {
      // best-effort
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  G5 Spike: Free Account WDA Preinstall Test  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Device: ${UDID}`);
  console.log(`Team:   ${TEAM_ID}`);
  console.log(`WDA:    ${WDA_PROJECT_PATH}`);
  console.log(`Evidence: ${EVIDENCE_DIR}`);
  console.log('');

  // Phase 1: Build & Install WDA
  log('Main', '=== PHASE 1: Prepare WDA ===');
  let wdaReady = false;
  try {
    const result = await prepareWda();
    wdaReady = result.installed;
    log('Main', `WDA preparation: ${wdaReady ? 'SUCCESS' : 'FAILED'}`);
  } catch (err) {
    log('Main', `WDA preparation ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!wdaReady) {
    log('Main', 'SKIPPING Route A — WDA not installed');
    log('Main', 'SKIPPING Route B — WDA not installed');
  } else {
    // Phase 2: Route B (external-url) — WDA already running, test connection
    log('Main', '');
    log('Main', '=== PHASE 2: Route B (external-url) ===');
    const routeBPassed = await testRouteB_ExternalUrl();
    log('Main', `Route B: ${routeBPassed ? 'PASS' : 'FAIL'}`);

    // Phase 3: Route A (preinstalled) — Appium uses device-installed WDA
    log('Main', '');
    log('Main', '=== PHASE 3: Route A (preinstalled) ===');
    const routeAPassed = await testRouteA_Preinstalled();
    log('Main', `Route A: ${routeAPassed ? 'PASS' : 'FAIL'}`);
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(`Evidence directory: ${EVIDENCE_DIR}`);
  console.log('═══════════════════════════════════════');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
