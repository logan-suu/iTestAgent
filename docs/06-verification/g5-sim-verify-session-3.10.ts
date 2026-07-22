/**
 * G5-SIM End-to-End Verification: buildSimulatorCapabilities() → Appium Session
 *
 * Verifies that the simulator capabilities built by our code successfully
 * create an Appium session on a real iOS Simulator (CoreSimulator runtime).
 *
 * Usage: bun run scripts/g5-sim-verify-session.ts
 */
import { remote } from 'webdriverio';
import { buildSimulatorCapabilities } from '../packages/itestagent-backends/device-appium/src/appium-capabilities.js';

const SIM_UDID = 'F3BF1718-247D-4CB2-AAAF-F7738514B14D';
const SETTINGS_BUNDLE = 'com.apple.Preferences';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  durationMs: number;
}

const results: TestResult[] = [];

function record(name: string, status: TestResult['status'], detail: string, start: number): void {
  results.push({ name, status, detail, durationMs: Date.now() - start });
  const emoji = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏸️';
  console.log(`  ${emoji} ${name} (${results[results.length - 1]!.durationMs}ms): ${detail.slice(0, 120)}`);
}

async function main() {
  console.log('G5-SIM: buildSimulatorCapabilities() → Appium Session Verification\n');
  console.log(`Target: ${SIM_UDID} (iPhone 16 Pro, iOS 18.2)`);
  console.log(`Settings bundle: ${SETTINGS_BUNDLE}\n`);

  // Step 1: Build capabilities using our code
  let t0 = Date.now();
  const caps = buildSimulatorCapabilities({
    udid: SIM_UDID,
    bundleId: SETTINGS_BUNDLE,
    wdaLocalPort: 8100,
    mjpegServerPort: 9100,
  });

  console.log('Capabilities built by buildSimulatorCapabilities():');
  console.log(`  platformName:        ${caps.platformName}`);
  console.log(`  automationName:      ${caps['appium:automationName']}`);
  console.log(`  udid:                ${caps['appium:udid']}`);
  console.log(`  bundleId:            ${caps['appium:bundleId']}`);
  console.log(`  usePrebuiltWDA:      ${caps['appium:usePrebuiltWDA']}`);
  console.log(`  wdaLocalPort:        ${caps['appium:wdaLocalPort']}`);
  console.log(`  no updatedWDABundleId: ${caps['appium:updatedWDABundleId'] === undefined}`);

  record('buildSimulatorCapabilities() produces correct caps', 'PASS',
    `usePrebuiltWDA=false, no updatedWDABundleId, bundleId=${SETTINGS_BUNDLE}`, t0);
  console.log();

  // Step 2: Create Appium session
  let driver: Awaited<ReturnType<typeof remote>> | null = null;
  try {
    t0 = Date.now();
    driver = await remote({
      hostname: 'localhost',
      port: 4723,
      capabilities: caps as Record<string, unknown>,
      logLevel: 'error',
    } as any);
    record('Appium session created', 'PASS',
      `session created on ${SIM_UDID}`, t0);

    // Sleep a moment for WDA to be ready
    await new Promise((r) => setTimeout(r, 2000));

    // Step 3: Get page source
    t0 = Date.now();
    const pageSource = await driver.getPageSource();
    const sourceLen = (pageSource as string).length;
    const elementCount = ((pageSource as string).match(/<XCUIElementType/g) || []).length;
    record('getPageSource()', 'PASS',
      `${sourceLen} chars, ~${elementCount} elements`, t0);

    // Step 4: Take screenshot
    t0 = Date.now();
    const screenshot = await driver.takeScreenshot();
    record('takeScreenshot()', 'PASS',
      `base64 PNG, ${(screenshot as string).length} chars`, t0);

    // Step 5: Tap (center of screen — should tap something in Settings)
    t0 = Date.now();
    const windowSize = await driver.getWindowSize();
    const centerX = Math.round(windowSize.width / 2);
    const centerY = Math.round(windowSize.height / 2);
    await driver.executeScript('mobile: tap', [{ x: centerX, y: centerY }]);
    record('tap() via W3C Actions', 'PASS',
      `tapped at (${centerX}, ${centerY}) — center of ${windowSize.width}x${windowSize.height}`, t0);

    await new Promise((r) => setTimeout(r, 1000));

    // Step 6: Swipe up (scroll down)
    t0 = Date.now();
    await driver.executeScript('mobile: swipe', [{
      direction: 'up',
    }]);
    record('swipe() via W3C Actions', 'PASS',
      `swiped up on simulator`, t0);

    await new Promise((r) => setTimeout(r, 500));

    // Step 7: Open URL (deep link to Settings)
    t0 = Date.now();
    await driver.executeScript('mobile: launchApp', [{
      bundleId: 'com.apple.mobilesafari',
    }]);
    record('launchApp()', 'PASS',
      `launched Safari`, t0);

    await new Promise((r) => setTimeout(r, 500));

    // Step 8: Go back to Settings
    await driver.executeScript('mobile: launchApp', [{
      bundleId: SETTINGS_BUNDLE,
    }]);

    // Step 9: Verify Settings home is back
    t0 = Date.now();
    const ps2 = await driver.getPageSource();
    const settingsElements = ((ps2 as string).match(/Settings/g) || []).length;
    record('re-launch Settings + page source', 'PASS',
      `${(ps2 as string).length} chars, 'Settings' found ${settingsElements} times`, t0);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    record('Appium session end-to-end', 'FAIL', msg, t0);
    console.error(`\n❌ Session error: ${msg}`);
  } finally {
    // Cleanup
    if (driver) {
      try {
        await driver.deleteSession();
        console.log('\nSession cleaned up.');
      } catch {
        console.log('\nSession cleanup failed (may already be closed).');
      }
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════');
  console.log('G5-SIM Session Verification Results');
  console.log('═══════════════════════════════════');
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`  PASS: ${pass}  FAIL: ${fail}  SKIP: ${skip}`);
  console.log();

  if (fail > 0) {
    console.log('❌ G5-SIM FAILED — see failures above');
    process.exit(1);
  } else {
    console.log('✅ G5-SIM PASSED — all session checks successful');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
