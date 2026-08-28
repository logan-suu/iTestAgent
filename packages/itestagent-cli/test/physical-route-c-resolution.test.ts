import { describe, expect, it } from 'bun:test';
import { resolveRouteC } from '../src/physical-route-c-resolution.js';

describe('resolveRouteC', () => {
  it('returns the appium-managed route by default', () => {
    expect(resolveRouteC({}).route).toBe('route_c_appium_managed');
  });
});
