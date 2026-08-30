/**
 * Exploration surface wiring — composes the real-device exploration stack
 * for CLI/TUI surfaces:
 *
 *   AppiumDeviceBackend (physical, WDA route from config)
 *   + LLM suggestion provider (config-driven, US-18.2 + US-11.1 AC4)
 *
 * AGENTS.md §4: CLI/TUI import this engine module (never the backends
 * directly). The API key is resolved from the keychain by the caller
 * (R6: memory-only).
 */
import {
  AppiumDeviceBackend,
  RealAppiumDriver,
  createIProxyTunnel,
} from 'itestagent-backends-device-appium';
import type { IProxyTunnel } from 'itestagent-backends-device-appium';
import { type SuggesterModelConfig, createConfiguredGenerateFn } from './assertion-suggester.js';

/** Configuration for the appium exploration backend. */
export interface ExplorationSurfaceConfig {
  /** Device hardware UDID. */
  udid: string;
  /** AUT bundle id. */
  bundleId: string;
  /** iOS version — REQUIRED for appium's RemoteXPC device matching on iOS 17+ (G5 finding). */
  platformVersion?: string;
  /** WDA startup route. Default: managed-xcodebuild. */
  wdaStartupMode?: 'preinstalled' | 'external-url' | 'managed-xcodebuild';
  /** Signing team ID (managed-xcodebuild route). */
  xcodeOrgId?: string;
  xcodeSigningId?: string;
  /** WDA base bundle id (free-account 3-app slot reuse). */
  wdaBundleId?: string;
  /** Mac-side WDA port (default 8100). */
  wdaLocalPort?: number;
  /** Appium server URL (default http://127.0.0.1:4723). */
  appiumServerUrl?: string;
  /** iproxy binary path override (external-url route tunnel). */
  iproxyPath?: string;
}

/** LLM suggestion hook config (US-18.2 model config + goal). */
export interface ExplorationLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  goal: string;
  featureName?: string;
}

/** Composed exploration runtime pieces. */
export interface ExplorationRuntime {
  readonly backend: AppiumDeviceBackend;
  readonly tunnel: IProxyTunnel | undefined;
  /** LLM suggestion hook — present only when model config is complete. */
  readonly llmSuggest?: {
    generate: (prompt: string) => Promise<string>;
    goal: string;
    featureName?: string;
  };
  /** Close the session and tear down the tunnel. */
  close(): Promise<void>;
}

/**
 * Compose the appium exploration backend + tunnel + LLM suggester from
 * surface config. The caller owns the returned runtime's lifecycle
 * (close() after the run).
 */
export function createAppiumExplorationRuntime(
  config: ExplorationSurfaceConfig,
  llm?: { baseUrl: string; apiKey: string; model: string; goal: string; featureName?: string },
): ExplorationRuntime {
  const tunnel = createIProxyTunnel({ iproxyPath: config.iproxyPath });

  const backend = new AppiumDeviceBackend(
    new RealAppiumDriver(config.appiumServerUrl ?? 'http://127.0.0.1:4723'),
    {
      udid: config.udid,
      targetKind: 'physical',
      bundleId: config.bundleId,
      // G5 finding: platformVersion is REQUIRED for appium's RemoteXPC device
      // matching on iOS 17+ — without it session creation fails with
      // "Unknown device or simulator UDID".
      platformVersion: config.platformVersion,
      wdaStartupMode: config.wdaStartupMode ?? 'managed-xcodebuild',
      xcodeOrgId: config.xcodeOrgId,
      xcodeSigningId: config.xcodeSigningId ?? 'Apple Development',
      wdaBundleId: config.wdaBundleId,
      wdaLocalPort: config.wdaLocalPort ?? 8100,
      iproxyTunnel: tunnel,
    },
  );

  const llmSuggest =
    llm?.baseUrl && llm.apiKey && llm.model
      ? {
          generate: createConfiguredGenerateFn({
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            model: llm.model,
          }),
          goal: llm.goal,
          ...(llm.featureName ? { featureName: llm.featureName } : {}),
        }
      : undefined;

  return {
    backend,
    tunnel,
    ...(llmSuggest ? { llmSuggest } : {}),
    async close(): Promise<void> {
      await backend.closeSession();
      tunnel.stop();
    },
  };
}
