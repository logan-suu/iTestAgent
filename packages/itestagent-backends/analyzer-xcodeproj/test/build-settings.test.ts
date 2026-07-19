import { describe, expect, it } from 'bun:test';
import { ResolvedBuildSettingsSchema } from 'itestagent-contracts';
import type { ResolvedBuildSettings } from 'itestagent-contracts';

describe('buildSettings — ResolvedBuildSettings schema', () => {
  it('validates complete build settings', () => {
    const settings: ResolvedBuildSettings = {
      bundleIdentifier: 'com.example.MyApp',
      bundleName: 'MyApp',
      deploymentTarget: '16.0',
      swiftVersion: '5.0',
      architectures: ['arm64'],
      infoPlistPath: 'MyApp/Info.plist',
    };

    const result = ResolvedBuildSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('validates minimal build settings (all optional fields)', () => {
    const settings: ResolvedBuildSettings = {
      architectures: [],
    };

    const result = ResolvedBuildSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('validates multiple architectures', () => {
    const settings: ResolvedBuildSettings = {
      architectures: ['arm64', 'x86_64'],
    };

    const result = ResolvedBuildSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.architectures).toHaveLength(2);
      expect(result.data.architectures).toContain('arm64');
      expect(result.data.architectures).toContain('x86_64');
    }
  });

  it('rejects missing architectures (required field)', () => {
    const result = ResolvedBuildSettingsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects extra fields (strict schema)', () => {
    const result = ResolvedBuildSettingsSchema.safeParse({
      architectures: [],
      extraField: 'nope',
    });

    expect(result.success).toBe(false);
  });

  it('accepts undefined optional fields', () => {
    const settings = {
      architectures: ['arm64'],
      bundleIdentifier: undefined,
      bundleName: undefined,
    };

    const result = ResolvedBuildSettingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });
});
