/**
 * Assertion observation mapping tests — UI tree → evaluator facts.
 */
import { describe, expect, it } from 'bun:test';
import type { UserAssertion } from 'itestagent-contracts';
import {
  elementVisibleInTree,
  findElementNodeAttrs,
  observationsFromUiTrees,
} from '../../src/exploration/assertion-observations.js';

const TREE_LOGIN = `<XCUIElementTypeApplication>
  <XCUIElementTypeButton name="login_button" label="Log in" />
  <XCUIElementTypeStaticText label="Welcome" />
  <XCUIElementTypeButton name="submit" enabled="false" />
  <XCUIElementTypeStaticText label="Log &amp; join" />
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

  it('matches XML-escaped attribute values', () => {
    expect(elementVisibleInTree(TREE_LOGIN, 'Log & join')).toBe(true);
  });

  it('does not match attribute-name substrings', () => {
    expect(elementVisibleInTree(TREE_LOGIN, 'login_butto')).toBe(false);
  });
});

describe('findElementNodeAttrs', () => {
  it('returns the matched node attributes', () => {
    const attrs = findElementNodeAttrs(TREE_LOGIN, 'submit');
    expect(attrs).toContain('name="submit"');
    expect(attrs).toContain('enabled="false"');
  });

  it('returns null when no node matches', () => {
    expect(findElementNodeAttrs(TREE_EMPTY, 'login_button')).toBeNull();
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

  it('maps element_text to the node text value', () => {
    const obs = observationsFromUiTrees(
      [
        assert({
          type: 'element_text',
          target: 'login_button',
          expected: 'Log in',
          description: 'd',
        }),
      ],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ login_button_text: 'Log in' });
  });

  it('decodes XML entities in extracted text', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'element_text', target: 'Log & join', description: 'd' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ 'Log & join_text': 'Log & join' });
  });

  it('skips element_text when the element is absent (stays unchecked)', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'element_text', target: 'missing_button', expected: 'x', description: 'd' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toBeUndefined();
  });

  it('maps element_disabled to the enabled attribute', () => {
    const obs = observationsFromUiTrees(
      [
        assert({ type: 'element_disabled', target: 'submit', description: 'd' }),
        assert({ type: 'element_disabled', target: 'login_button', description: 'd' }),
      ],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ submit_enabled: false, login_button_enabled: true });
  });

  it('maps navigation_reached to the reached fact', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'navigation_reached', target: 'Welcome', description: 'd' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ Welcome_reached: true });
  });

  it('emits crashDetected=false for no_crash conditions', () => {
    const obs = observationsFromUiTrees(
      [assert({ type: 'no_crash', description: 'd' })],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ crashDetected: false });
  });

  it('accumulates facts when multiple assertions share one caseId', () => {
    const obs = observationsFromUiTrees(
      [
        assert({ type: 'element_visible', target: 'login_button', description: 'd' }),
        assert({ type: 'no_crash', description: 'd' }),
      ],
      [{ caseId: 'login', raw: TREE_LOGIN }],
    );
    expect(obs.login).toEqual({ login_button_visible: true, crashDetected: false });
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
