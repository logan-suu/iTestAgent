/**
 * Phase 6 physical closed-loop production contract (Task 6.1).
 *
 * Tasks 6.2-6.11 now satisfy this structural contract. It remains enabled as a
 * normal regression guard for the production composition and data flow.
 *
 * The assertions parse production entry points and require executable calls and
 * data flow. Comments, unused imports, aliases, and formatting cannot satisfy
 * the contract.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const contract = it;
const repoRoot = resolve(import.meta.dir, '../../..');

interface ParsedSource {
  file: ts.SourceFile;
  text: string;
}

function parseSource(relativePath: string): ParsedSource {
  const text = readFileSync(resolve(repoRoot, relativePath), 'utf-8');
  return {
    file: ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true),
    text,
  };
}

function descendants<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function calleeName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return undefined;
}

function commandInChain(expression: ts.Expression): string | undefined {
  if (ts.isCallExpression(expression)) {
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === 'command'
    ) {
      const name = expression.arguments[0];
      return name && ts.isStringLiteralLike(name) ? name.text : undefined;
    }
    return commandInChain(expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) return commandInChain(expression.expression);
  return undefined;
}

function commandAction(file: ts.SourceFile, command: string): ts.ConciseBody {
  const action = descendants(file, ts.isCallExpression).find((call) => {
    if (!ts.isPropertyAccessExpression(call.expression)) return false;
    return (
      call.expression.name.text === 'action' &&
      commandInChain(call.expression.expression)?.split(' ')[0] === command
    );
  });
  const callback = action?.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
    throw new Error(`missing executable action for CLI command: ${command}`);
  }
  return callback.body;
}

function moduleBindings(file: ts.SourceFile, moduleName: string): Set<string> {
  const bindings = new Set<string>();
  for (const declaration of file.statements) {
    if (
      !ts.isImportDeclaration(declaration) ||
      !ts.isStringLiteral(declaration.moduleSpecifier) ||
      declaration.moduleSpecifier.text !== moduleName
    ) {
      continue;
    }
    const clause = declaration.importClause;
    if (clause?.name) bindings.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) bindings.add(element.name.text);
    }
  }
  return bindings;
}

function hasExecutableUse(roots: readonly ts.Node[], bindings: Set<string>): boolean {
  return (
    roots.some((root) =>
      descendants(root, ts.isCallExpression).some(
        (call) => ts.isIdentifier(call.expression) && bindings.has(call.expression.text),
      ),
    ) ||
    roots.some((root) =>
      descendants(root, ts.isNewExpression).some(
        (expression) =>
          ts.isIdentifier(expression.expression) && bindings.has(expression.expression.text),
      ),
    )
  );
}

function moduleLiteralMatches(root: ts.Node, pattern: RegExp): boolean {
  return descendants(root, ts.isStringLiteralLike).some((literal) => pattern.test(literal.text));
}

function propertyValue(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      candidate.name.getText().replaceAll(/["']/g, '') === name,
  );
  return property?.initializer;
}

function stringValue(expression: ts.Expression | undefined): string | undefined {
  return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
}

function variableInitializers(root: ts.Node): Map<string, ts.Expression> {
  const result = new Map<string, ts.Expression>();
  for (const declaration of descendants(root, ts.isVariableDeclaration)) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) {
      result.set(declaration.name.text, declaration.initializer);
    }
  }
  return result;
}

function resolveExpression(
  expression: ts.Expression | undefined,
  initializers: Map<string, ts.Expression>,
): ts.Expression | undefined {
  let current = expression;
  const visited = new Set<string>();
  while (current && ts.isIdentifier(current) && !visited.has(current.text)) {
    visited.add(current.text);
    current = initializers.get(current.text);
  }
  return current;
}

function hasAllowAllRule(root: ts.Node): boolean {
  const initializers = variableInitializers(root);
  return descendants(root, ts.isCallExpression).some((call) => {
    if (calleeName(call) !== 'addRule') return false;
    const rule = resolveExpression(call.arguments[0], initializers);
    return (
      !!rule &&
      ts.isObjectLiteralExpression(rule) &&
      stringValue(propertyValue(rule, 'action')) === '*' &&
      stringValue(propertyValue(rule, 'resource')) === '*' &&
      stringValue(propertyValue(rule, 'effect')) === 'allow'
    );
  });
}

function hasCall(root: ts.Node, name: string): boolean {
  return descendants(root, ts.isCallExpression).some((call) => calleeName(call) === name);
}

function reachableFunctionBodies(file: ts.SourceFile, entry: string): ts.ConciseBody[] {
  const functions = new Map<string, ts.ConciseBody>();
  for (const declaration of descendants(file, ts.isFunctionDeclaration)) {
    if (declaration.name && declaration.body)
      functions.set(declaration.name.text, declaration.body);
  }
  for (const declaration of descendants(file, ts.isVariableDeclaration)) {
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
    ) {
      functions.set(declaration.name.text, declaration.initializer.body);
    }
  }

  const reachable: ts.ConciseBody[] = [];
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const name = pending.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const body = functions.get(name);
    if (!body) continue;
    reachable.push(body);
    for (const call of descendants(body, ts.isCallExpression)) {
      const called = calleeName(call);
      if (called && functions.has(called)) pending.push(called);
    }
  }
  return reachable;
}

function identifierFlowsIntoCall(root: ts.Node, producer: string, consumers: RegExp): boolean {
  const produced = descendants(root, ts.isVariableDeclaration)
    .filter((declaration) => {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return false;
      return descendants(declaration.initializer, ts.isCallExpression).some(
        (call) => calleeName(call) === producer,
      );
    })
    .map((declaration) => (declaration.name as ts.Identifier).text);

  return descendants(root, ts.isCallExpression).some((call) => {
    const name = calleeName(call);
    if (!name || !consumers.test(name)) return false;
    return call.arguments.some((argument) =>
      descendants(argument, ts.isIdentifier).some((identifier) =>
        produced.includes(identifier.text),
      ),
    );
  });
}

function hasFixedExploreActions(root: ts.Node): boolean {
  return descendants(root, ts.isObjectLiteralExpression).some((object) => {
    const action = stringValue(propertyValue(object, 'action'));
    const target = propertyValue(object, 'target');
    return (
      (action === 'launch' && !!target) ||
      (action === 'screenshot' && stringValue(target) === 'explore')
    );
  });
}

function assignedInstance(root: ts.Node, className: string): string | undefined {
  return descendants(root, ts.isVariableDeclaration)
    .find((declaration) => {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return false;
      return descendants(declaration.initializer, ts.isNewExpression).some(
        (expression) =>
          ts.isIdentifier(expression.expression) && expression.expression.text === className,
      );
    })
    ?.name.getText();
}

function callsMethodOn(root: ts.Node, receiver: string | undefined, method: string): boolean {
  if (!receiver) return false;
  return descendants(root, ts.isCallExpression).some(
    (call) =>
      ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression) &&
      call.expression.expression.text === receiver &&
      call.expression.name.text === method,
  );
}

function loadsParentResultIntoExecution(root: ts.Node): boolean {
  const initializers = variableInitializers(root);
  const loadedParents = new Set(
    descendants(root, ts.isVariableDeclaration)
      .filter(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          !!declaration.initializer &&
          descendants(declaration.initializer, ts.isCallExpression).some(
            (call) => calleeName(call) === 'loadRunBundle',
          ),
      )
      .map((declaration) => declaration.name.getText()),
  );
  return descendants(root, ts.isCallExpression).some((call) => {
    if (calleeName(call) !== 'executeProductionTestPlan') return false;
    const input = resolveExpression(call.arguments[0], initializers);
    if (!input || !ts.isObjectLiteralExpression(input)) return false;
    const parentResult = propertyValue(input, 'parentResult');
    return (
      !!parentResult &&
      descendants(parentResult, ts.isPropertyAccessExpression).some(
        (access) =>
          access.name.text === 'result' &&
          ts.isIdentifier(access.expression) &&
          loadedParents.has(access.expression.text),
      )
    );
  });
}

const tui = parseSource('packages/itestagent-tui/src/agent-session.ts');
const productionSession = parseSource('packages/itestagent-engine/src/production-agent-session.ts');
const cli = parseSource('packages/itestagent-cli/src/cli.ts');
const rerunHandler = parseSource('packages/itestagent-cli/src/commands/rerun.ts');
const exploreAction = commandAction(cli.file, 'explore');
const rerunAction = commandAction(cli.file, 'rerun');
const runFlowAction = commandAction(cli.file, 'flow');
const reachableTui = reachableFunctionBodies(tui.file, 'createAgentSession');

describe('Phase 6 production physical closed-loop contract', () => {
  contract('US-4.1/17.1: TUI production session has no mock backend dependency', () => {
    expect(moduleLiteralMatches(tui.file, /(?:^|[/\-])device-mock$/)).toBe(false);
  });

  contract('US-17.2: TUI production session has no semantic allow-all rule', () => {
    expect(hasAllowAllRule(tui.file)).toBe(false);
  });

  contract('US-4.1/6.1: TUI executes the real project analyzer', () => {
    expect(
      reachableTui.some((body) => hasCall(body, 'createProductionAgentSessionDependencies')),
    ).toBe(true);
    const analyzerBindings = moduleBindings(productionSession.file, 'itestagent-project-analyzer');
    expect(
      hasExecutableUse(
        reachableFunctionBodies(productionSession.file, 'createProductionAgentSessionDependencies'),
        analyzerBindings,
      ),
    ).toBe(true);
  });

  contract('US-4.1/17.1: TUI executes real device discovery', () => {
    expect(reachableTui.some((body) => hasCall(body, 'listDevices'))).toBe(true);
  });

  contract('US-5.2/8.1/9.1: a parsed confirmed plan flows into exploration execution', () => {
    expect(identifierFlowsIntoCall(exploreAction, 'parseTestPlanYaml', /^run/)).toBe(true);
  });

  contract('US-8.1/9.1: explore does not embed fixed launch/screenshot actions', () => {
    expect(hasFixedExploreActions(exploreAction)).toBe(false);
  });

  contract('US-13.1/15.1: explore derives its run directory from RunStore', () => {
    expect(
      hasCall(exploreAction, 'createDefaultRunStore') && hasCall(exploreAction, 'getRunDir'),
    ).toBe(true);
  });

  contract('US-15.1: explore commits through the canonical run-bundle coordinator', () => {
    expect(hasCall(exploreAction, 'persistRunBundle')).toBe(true);
  });

  contract('US-9.2/R5: flow execution has no mock backend module dependency', () => {
    expect(moduleLiteralMatches(runFlowAction, /(?:^|[/\-])device-mock$/)).toBe(false);
  });

  contract('US-16.1: rerun invokes production execution dispatch', () => {
    expect(hasCall(rerunAction, 'runRerunCommand')).toBe(true);
    expect(hasCall(rerunHandler.file, 'executeProductionTestPlan')).toBe(true);
  });

  contract('US-16.1: rerun sends the loaded parent result into canonical execution', () => {
    expect(loadsParentResultIntoExecution(rerunHandler.file)).toBe(true);
    expect(
      identifierFlowsIntoCall(rerunHandler.file, 'createRerunPlan', /^executeProductionTestPlan$/),
    ).toBe(true);
  });
});

describe('Phase 6 semantic contract matcher', () => {
  it('does not accept comments or unused imports as executable behavior', () => {
    const fixture = ts.createSourceFile(
      'fixture.ts',
      `
        import { ReportSynthesizer } from 'itestagent-report';
        import { analyzeProject } from 'itestagent-project-analyzer';
        // executeProductionTestPlan({ parentResult: parent.result });
      `,
      ts.ScriptTarget.Latest,
      true,
    );

    expect(loadsParentResultIntoExecution(fixture)).toBe(false);
    expect(
      hasExecutableUse([fixture], moduleBindings(fixture, 'itestagent-project-analyzer')),
    ).toBe(false);
    expect(assignedInstance(fixture, 'ReportSynthesizer')).toBeUndefined();
  });

  it('detects aliased mock modules and indirect allow-all rules', () => {
    const fixture = ts.createSourceFile(
      'fixture.ts',
      `
        const backendModule = 'itestagent-device-mock';
        const rule = { effect: 'allow', resource: '*', action: '*' };
        permissionEngine.addRule(rule);
      `,
      ts.ScriptTarget.Latest,
      true,
    );

    expect(moduleLiteralMatches(fixture, /(?:^|[/\-])device-mock$/)).toBe(true);
    expect(hasAllowAllRule(fixture)).toBe(true);
  });

  it('requires a loaded canonical parent result to flow into production execution', () => {
    const fixture = ts.createSourceFile(
      'fixture.ts',
      `
        const parent = await store.loadRunBundle(runId);
        await executeProductionTestPlan({ parentResult: parent.result });
      `,
      ts.ScriptTarget.Latest,
      true,
    );

    expect(loadsParentResultIntoExecution(fixture)).toBe(true);
  });
});
