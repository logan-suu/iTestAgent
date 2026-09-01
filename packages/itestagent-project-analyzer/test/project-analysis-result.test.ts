import { describe, expect, it } from 'bun:test';
import type { ProjectAnalyzerBackend } from 'itestagent-contracts';
import { XCODEPROJ_TIER1_ANALYSIS, analyzeProject } from '../src/project-analysis-result.js';

const backend: ProjectAnalyzerBackend = {
  discover: async () => ({
    root: '/tmp/App',
    name: 'App',
    type: 'xcode_project',
    schemes: ['App'],
    configurations: ['Debug'],
  }),
  graph: async () => ({
    targets: [{ name: 'App', type: 'app', dependencies: [] }],
    hasXCUITests: false,
    hasUnitTests: false,
  }),
  buildSettings: async () => ({
    bundleIdentifier: 'dev.itestagent.app',
    architectures: ['arm64'],
  }),
  scanSources: async () => ({
    swiftFiles: 0,
    objcFiles: 0,
    viewControllers: [],
    protocols: [],
    storyboardRefs: [],
    xibRefs: [],
  }),
  scanResources: async () => ({
    assetCatalogs: 0,
    fontFiles: [],
    localizedStrings: [],
    infoPlistKeys: [],
  }),
};

describe('ADR-026 project analysis result', () => {
  it('adds session-only XCUITest candidates without changing project-profile.v1', async () => {
    const result = await analyzeProject(
      {
        ...backend,
        graph: async () => ({
          targets: [{ name: 'AppUITests', type: 'test', dependencies: [] }],
          hasXCUITests: true,
          hasUnitTests: false,
          xcuitestTargets: ['AppUITests'],
        }),
        discoverXcuitestExecutionAssets: async (input) => ({
          status: 'available',
          configurations: [
            {
              scheme: 'App',
              targets: ['AppUITests'],
              targetKind: input.targetKind,
              isDefault: true,
              evidence: ['shared scheme TestAction metadata'],
              limitations: [],
            },
          ],
          evidence: [],
          limitations: [],
        }),
      },
      '/tmp/App',
    );
    expect(result.analysis.executionAssets?.configurations).toHaveLength(2);
    expect(result.analysis.executionAssets?.status).toBe('available');
    expect(result.analysis.executionAssets?.configurations.map((item) => item.targetKind)).toEqual([
      'physical',
      'simulator',
    ]);
    expect('executionAssets' in result.profile).toBe(false);
  });

  it('keeps analyzer failures indeterminate instead of proving candidate absence', async () => {
    const result = await analyzeProject(
      {
        ...backend,
        discoverXcuitestExecutionAssets: async () => {
          throw new Error('metadata unavailable');
        },
      },
      '/tmp/App',
    );
    expect(result.analysis.executionAssets).toMatchObject({
      status: 'indeterminate',
      configurations: [],
    });
  });

  it('wraps project-profile.v1 with explicit tier and limitations', async () => {
    const result = await analyzeProject(backend, '/tmp/App');
    expect(result.profile.schemaVersion).toBe('itestagent.project-profile.v1');
    expect(result.analysis.analysisTier).toBe('tier1_static');
    expect(result.analysis.enabledCapabilities).toContain('xcodebuild_discovery');
    expect(result.analysis.limitations.length).toBeGreaterThan(0);
    expect('analysis' in result.profile).toBe(false);
  });

  it('returns fresh capability arrays instead of the exported constant references', async () => {
    const result = await analyzeProject(backend, '/tmp/App');
    expect(result.analysis.enabledCapabilities).not.toBe(
      XCODEPROJ_TIER1_ANALYSIS.enabledCapabilities,
    );
    expect(result.analysis.limitations).not.toBe(XCODEPROJ_TIER1_ANALYSIS.limitations);
  });
});
