/**
 * Assertion observation mapping tests — UI tree → evaluator facts.
 */
import { describe, expect, it } from 'bun:test';
import type { UserAssertion } from 'itestagent-contracts';
import {
  elementVisibleInTree,
  observationsFromUiTrees,
} from '../../src/exploration/assertion-observations.js';

const TREE_LOGIN = `<XCUIElementTypeApplication>
  <XCUIElementTypeButton name="login_button" label="Log in" />
  <XCUIElementTypeStaticText label="Welcome" />
</XCUIElementTypeApplication>`;
const TREE_EMPTY = '<XCUIElementTypeApplication />';

function assert(cond: UserAssertion['conditions'][number], caseId = 'login'): UserAssertion {
  return { id: 'a1', caseId, source: 'user', conditions: [cond] };
}

describe('elementVisibleInTree', () => {
  it('matches name, label and value attributes', () => {
    expect(elementVisibleInTree(TREE_LOGIN, 'login_button')).toBe(true);
    expect(elementVisibleInTree(TREE_LOGIN, 'Log in')).toBe(true);
    expect(elementVisibleInTree(TREE_LOGIN, 'Welcome')).toBe(true);
    expect(elementVisibleInTree(TREE_LOGIN, 'missing')).toBe(false);
    expect(elementVisibleInTree('', 'anything')).toBe(false);
  });
});

describe('observationsFromUiTrees', () => {
  it('emits target_visible facts per case', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'element_visible', target: 'login_button', description: 'd' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ login_button_visible: true });
  });

  it('marks targets absent from the tree as visible=false', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'element_visible', target: 'missing_button', description: 'd' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ missing_button_visible: false });
  });

  it('emits crashDetected=false for no_crash conditions', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'no_crash', description: 'd' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ crashDetected: false });
  });

  it('skips cases with no captured tree (evaluator marks unchecked)', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'element_visible', target: 'login_button', description: 'd' })],
      [{ caseId: 'other', raw: TREE_EMPTY }],
    );
    expect(obs.login).toBeUndefined();
  });

  it('emits nothing when a case produces no facts at all', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'custom', description: 'human judgment' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toBeUndefined();
  });
});
