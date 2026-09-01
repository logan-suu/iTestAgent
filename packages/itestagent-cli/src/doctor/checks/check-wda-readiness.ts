/**
 * WDA readiness check — polls localhost:PORT/status for ready:true.
 *
 * US-1.2 AC1: pass/fail/manual three-state.
 * US-1.3 AC1: recognizes "WDA not running yet" scenario.
 *
 * Checks if a running WebDriverAgent instance at http://127.0.0.1:PORT/status
 * responds with `{ "value": { "ready": true } }`. This is the primary
 * health check for Route B (external-url mode) and for confirming that
 * WDA is ready after launch.
 *
 * Uses Node.js http.get (no external dependencies beyond Node stdlib).
 * Accepts port parameter (default: 8100).
 *
 * Returns:
 *   - 'pass' if WDA /status returns ready:true
 *   - 'fail' if connection refused, timeout, or returns ready:false
 *   - 'manual' if port unreachable but device might not need WDA yet
 *
 * AGENTS.md §3.1.4 (R12): comments in English.
 */
import http from 'node:http';
import type { DoctorCheckResult } from '../types.js';

/**
 * Check WDA /status endpoint.
 *
 * Sends GET request to http://127.0.0.1:PORT/status with a 5-second
 * timeout. Parses the JSON response and extracts value.ready.
 *
 * @param port - WDA HTTP port (default: 8100)
 * @returns Object with status and optional WDA metadata
 */
function checkWdaStatus(port: number): Promise<{
  ready: boolean;
  error?: string;
  details?: string;
}> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/status`, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        try {
          const body = JSON.parse(data) as {
            value?: { ready?: boolean; build?: Record<string, unknown> };
          };
          if (body.value?.ready === true) {
            const buildInfo = body.value.build
              ? `build: ${JSON.stringify(body.value.build)}`
              : 'no build info';
            resolve({ ready: true, details: buildInfo });
          } else {
            resolve({
              ready: false,
              error: `WDA responded but ready is not true (got: ${JSON.stringify(body.value)})`,
            });
          }
        } catch (parseErr) {
          resolve({
            ready: false,
            error: `WDA responded with non-JSON: ${data.slice(0, 200)}`,
          });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ready: false, error: 'Request timeout (5s)' });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({ ready: false, error: 'Connection refused — WDA not running' });
      } else if (err.code === 'ECONNRESET') {
        resolve({ ready: false, error: 'Connection reset — WDA may be restarting' });
      } else {
        resolve({ ready: false, error: `Network error: ${err.message}` });
      }
    });
  });
}

export async function checkWdaReadiness(port?: number): Promise<DoctorCheckResult> {
  const wdaPort = port ?? 8100;
  const details: string[] = [];
  details.push(`Checking WDA on port ${wdaPort}...`);

  const result = await checkWdaStatus(wdaPort);

  if (result.ready) {
    details.push('WDA status: ready ✓');
    if (result.details) {
      details.push(result.details);
    }
    return {
      name: 'WDA Readiness',
      status: 'pass',
      message: `WDA is running and ready on port ${wdaPort}.`,
      fixGuide: [
        'WDA is ready for Appium sessions',
        'Use wdaStartupMode: "external-url" with webDriverAgentUrl',
        `WDA URL: http://127.0.0.1:${wdaPort}`,
      ],
      details: details.join('\n'),
    };
  }

  // Connection refused — WDA definitely not running
  if (result.error?.includes('Connection refused')) {
    return {
      name: 'WDA Readiness',
      status: 'fail',
      message: `WDA is not running on port ${wdaPort} (connection refused).`,
      fixGuide: [
        'Launch WDA via WdaManager.launch() (Route B)',
        'Or build + install WDA via WdaManager.preparePreinstalledWDA(), then re-run an active probe',
        'Or let Appium manage WDA (Route C: managed-xcodebuild)',
        'Verify port availability: lsof -i :8100',
        'Start WDA manually: xcodebuild test-without-building -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination "platform=iOS,id=<UDID>"',
      ],
      details: details.join('\n'),
    };
  }

  // Timeout or other error — might be starting up
  if (result.error?.includes('timeout')) {
    return {
      name: 'WDA Readiness',
      status: 'fail',
      message: `WDA /status timed out on port ${wdaPort}. WDA may be starting up or hung.`,
      fixGuide: [
        'Check if WDA xcodebuild process is still running: ps aux | grep xcodebuild',
        'Wait for WDA build to complete (can take 2-5 minutes on first run)',
        'Re-run doctor after build completes',
        'If stuck, kill xcodebuild and restart: killall xcodebuild',
      ],
      details: details.join('\n'),
    };
  }

  // Other errors — WDA responding but not ready
  details.push(`WDA response: ${result.error ?? 'unknown error'}`);

  return {
    name: 'WDA Readiness',
    status: 'fail',
    message: `WDA responded on port ${wdaPort} but is not ready: ${result.error ?? 'unknown error'}.`,
    fixGuide: [
      'Wait for WDA to finish initializing (check xcodebuild output)',
      'If persistent, kill and restart WDA',
      'Check WDA logs for errors: look at xcodebuild stderr output',
    ],
    details: details.join('\n'),
  };
}
