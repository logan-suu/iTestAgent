import { describe, expect, it } from 'bun:test';
import { resolveRouteC } from '../src/physical-route-c-resolution.js';

describe('resolveRouteC', () => {
  it('returns the appium-managed route when explicitly selected', () => {
    expect(resolveRouteC({ preferWdaManager: false }).route).toBe('route_c_appium_managed');
  });
});
