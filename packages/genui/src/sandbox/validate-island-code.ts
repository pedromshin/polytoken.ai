/**
 * validate-island-code.ts — host-side, pre-execution AST allowlist for code-island source.
 *
 * This is the PRIMARY deterministic safety layer for the jailed-eval code-island (Phase 20).
 * Before any generated code is injected into the sandboxed iframe, it is parsed and walked;
 * references to a blocklisted API surface (network egress, host/parent access, storage,
 * dynamic eval, reflection/meta-programming, module imports) are rejected. This runs ON TOP of
 * the iframe `sandbox` attribute (opaque origin, no `allow-same-origin`) + inline `<meta>` CSP
 * (`connect-src 'none'`), which remain the RUNTIME enforcers — the allowlist is the cheapest
 * place to fail fast. (See 20-RESEARCH.md §3, §5.)
 *
 * Posture: FALSE POSITIVES ARE ACCEPTABLE — a flagged program routes to heal/reject, never runs.
 * So detection is deliberately conservative and covers common bypasses: computed member access
 * (`window["fetch"]`), template-literal keys (`window[`fetch`]`), window-object aliasing
 * (`const w = window; w.fetch()`), destructuring off a window receiver (`const {fetch} = window`),
 * reflection (`Reflect`, `.constructor`, `__proto__`), and dynamic computed access on a window
 * receiver (`window[expr]`, fail-closed). Non-foldable string tricks (`"fe"+"tch"`) that also
 * evade the folder are still contained by the runtime jail.
 *
 * Island code contract (spike): a plain JavaScript program string that runs inside the frame
 * against a fresh `document`. Parsed as an ES module so `import`/`export` surface as nodes.
 */

import { parse } from "@babel/parser";

/** A single allowlist violation found in island source. */
export interface IslandViolation {
  /** Stable rule id — one of the RULE_* categories. */
  readonly rule: IslandViolationRule;
  /** Human-readable detail (the offending identifier / member access). */
  readonly detail: string;
  /** 1-based source line, or null when unknown. */
  readonly line: number | null;
}

export type IslandViolationRule =
  | "import"
  | "require"
  | "dynamic-eval"
  | "network"
  | "storage"
  | "host-access"
  | "reflection";

/** Result of validating island source. `ok` is true only when there are zero violations. */
export interface ValidateIslandResult {
  readonly ok: boolean;
  readonly violations: readonly IslandViolation[];
  /** Syntax errors recovered by the parser (non-fatal; code may still be run + healed). */
  readonly syntaxErrors: readonly string[];
}

// Forbidden bare globals, grouped by rule category. A reference to any of these names
// (as a callee, member object, or standalone reference) is rejected.
const DYNAMIC_EVAL = new Set(["eval", "Function"]);
const NETWORK = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]);
const STORAGE = new Set(["localStorage", "sessionStorage", "indexedDB"]);
const HOST_ACCESS = new Set(["parent", "top", "opener", "frameElement", "frames"]);
const REFLECTION = new Set(["Reflect", "Proxy"]);

const ALL_FORBIDDEN = new Set<string>([
  ...DYNAMIC_EVAL,
  ...NETWORK,
  ...STORAGE,
  ...HOST_ACCESS,
  ...REFLECTION,
]);

// Window-like receivers: `window.fetch`, `self.parent`, `globalThis.localStorage`, …
const WINDOW_RECEIVERS = new Set(["window", "self", "globalThis"]);

// Reflective/meta property names — the classic `x.constructor.constructor("…")()` escape and
// prototype pollution. Rejected as a property name (dotted or computed) on ANY object.
const REFLECTIVE_PROPS = new Set(["constructor", "__proto__"]);

// Extra window-yielding property names on a window/document receiver.
const WINDOW_YIELDING_PROPS = new Set(["defaultView", "frames"]);

const IGNORED_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "errors",
  "tokens",
]);

interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

function ruleFor(name: string): IslandViolationRule | null {
  if (DYNAMIC_EVAL.has(name)) return "dynamic-eval";
  if (NETWORK.has(name)) return "network";
  if (STORAGE.has(name)) return "storage";
  if (HOST_ACCESS.has(name)) return "host-access";
  if (REFLECTION.has(name)) return "reflection";
  return null;
}

function lineOf(node: AstNode): number | null {
  const loc = node.loc as { start?: { line?: number } } | undefined;
  return loc?.start?.line ?? null;
}

/**
 * Resolve a MemberExpression's property name for dotted (`obj.name`) and statically-foldable
 * computed access — string literal (`obj["name"]`) and a single-quasi template (`obj[`name`]`).
 * Returns null for dynamic computed access (`obj[expr]`, `obj["a"+"b"]`) which cannot be resolved
 * statically; the caller treats a null result on a window receiver as fail-closed.
 */
function memberPropertyName(node: AstNode, prop: unknown): string | null {
  if (!isNode(prop)) return null;
  if (node.computed !== true) {
    return prop.type === "Identifier" ? (prop.name as string) : null;
  }
  if (prop.type === "StringLiteral") {
    return String((prop as { value?: unknown }).value ?? "");
  }
  if (prop.type === "TemplateLiteral") {
    const expressions = prop.expressions as unknown[] | undefined;
    const quasis = prop.quasis as Array<{ value?: { cooked?: string } }> | undefined;
    if ((expressions?.length ?? 0) === 0 && quasis?.length === 1) {
      return quasis[0]?.value?.cooked ?? null;
    }
  }
  return null;
}

/** Identifier name if `value` is a plain Identifier node, else null. */
function identifierName(value: unknown): string | null {
  return isNode(value) && value.type === "Identifier" ? (value.name as string) : null;
}

/**
 * Pre-pass: collect local identifiers aliased to a window receiver
 * (`const w = window`, `let s = self`, `x = globalThis`, chained via `const b = w`).
 * Iterates to a fixpoint so `const a = window; const b = a;` taints both.
 */
function collectWindowAliases(root: AstNode): Set<string> {
  const aliases = new Set<string>();
  const bindings: Array<{ name: string; source: string }> = [];

  const scan = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) scan(item);
      return;
    }
    if (!isNode(value)) return;
    if (value.type === "VariableDeclarator") {
      const name = identifierName(value.id);
      const source = identifierName(value.init);
      if (name && source) bindings.push({ name, source });
    }
    if (value.type === "AssignmentExpression" && value.operator === "=") {
      const name = identifierName(value.left);
      const source = identifierName(value.right);
      if (name && source) bindings.push({ name, source });
    }
    for (const key of Object.keys(value)) {
      if (IGNORED_KEYS.has(key)) continue;
      scan((value as Record<string, unknown>)[key]);
    }
  };
  scan(root);

  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, source } of bindings) {
      if (!aliases.has(name) && (WINDOW_RECEIVERS.has(source) || aliases.has(source))) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  return aliases;
}

/**
 * Validate island source against the API allowlist. See file header for the covered surface.
 */
export function validateIslandCode(code: string): ValidateIslandResult {
  let ast: AstNode;
  const syntaxErrors: string[] = [];
  try {
    ast = parse(code, {
      sourceType: "module",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AstNode;
  } catch (error) {
    return {
      ok: false,
      violations: [],
      syntaxErrors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const recovered = (ast as { errors?: ReadonlyArray<{ reason?: string } | Error> }).errors ?? [];
  for (const err of recovered) {
    const reason = (err as { reason?: string }).reason;
    syntaxErrors.push(reason ?? (err instanceof Error ? err.message : String(err)));
  }

  const windowAliases = collectWindowAliases(ast);
  const violations: IslandViolation[] = [];
  const namePositions = new WeakSet<AstNode>();

  const push = (rule: IslandViolationRule, detail: string, node: AstNode): void => {
    violations.push({ rule, detail, line: lineOf(node) });
  };

  const markNamePositions = (node: AstNode): void => {
    switch (node.type) {
      case "MemberExpression":
      case "OptionalMemberExpression": {
        if (node.computed !== true && isNode(node.property)) namePositions.add(node.property);
        break;
      }
      case "ObjectProperty":
      case "ObjectMethod":
      case "ClassProperty":
      case "ClassMethod":
      case "ClassPrivateProperty":
      case "ClassPrivateMethod": {
        if (node.computed !== true && isNode(node.key)) namePositions.add(node.key);
        break;
      }
      case "VariableDeclarator": {
        markPatternIds(node.id, namePositions);
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        if (isNode(node.id)) namePositions.add(node.id);
        const params = node.params;
        if (Array.isArray(params)) for (const p of params) markPatternIds(p, namePositions);
        break;
      }
      case "CatchClause": {
        markPatternIds(node.param, namePositions);
        break;
      }
      case "LabeledStatement":
      case "BreakStatement":
      case "ContinueStatement": {
        if (isNode(node.label)) namePositions.add(node.label);
        break;
      }
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "ExportSpecifier": {
        if (isNode(node.local)) namePositions.add(node.local);
        if (isNode(node.imported)) namePositions.add(node.imported);
        if (isNode(node.exported)) namePositions.add(node.exported);
        break;
      }
      default:
        break;
    }
  };

  const checkNode = (node: AstNode): void => {
    // Module imports / dynamic import.
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" && node.source != null)
    ) {
      push("import", node.type, node);
      return;
    }
    if (node.type === "Import") {
      push("import", "import()", node);
      return;
    }

    // require(...) calls.
    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (isNode(callee) && callee.type === "Identifier" && callee.name === "require") {
        push("require", "require()", node);
      }
    }

    // Destructuring off a window receiver: `const { fetch: f } = window` / `const { parent } = self`.
    if (node.type === "VariableDeclarator") {
      const source = identifierName(node.init);
      const fromWindow = source != null && (WINDOW_RECEIVERS.has(source) || windowAliases.has(source));
      if (fromWindow && isNode(node.id) && node.id.type === "ObjectPattern") {
        const props = node.id.properties;
        if (Array.isArray(props)) {
          for (const p of props) {
            if (isNode(p) && p.type === "ObjectProperty" && p.computed !== true) {
              const keyName = identifierName(p.key);
              if (keyName) {
                const rule = ruleFor(keyName) ?? (REFLECTIVE_PROPS.has(keyName) ? "reflection" : null);
                if (rule) push(rule, `destructured ${source}.${keyName}`, node);
              }
            }
          }
        }
      }
    }

    // Member access (dotted or computed) on window-like receivers / document / navigator,
    // plus reflective props and forbidden computed keys on any receiver.
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const obj = node.object;
      const objName = identifierName(obj);
      const objIsWindowLike =
        objName != null && (WINDOW_RECEIVERS.has(objName) || windowAliases.has(objName));
      const propName = memberPropertyName(node, node.property);

      if (propName !== null) {
        // Reflective/meta property on ANY object (constructor-chain / prototype pollution).
        if (REFLECTIVE_PROPS.has(propName)) {
          push("reflection", `.${propName}`, node);
        }
        // Forbidden name via COMPUTED access on any object: obj["fetch"], x["eval"].
        if (node.computed === true) {
          const rule = ruleFor(propName);
          if (rule) push(rule, `["${propName}"]`, node);
        }
        // Window-like receiver: window.fetch / self.parent / w.localStorage (alias).
        if (objIsWindowLike) {
          const rule = ruleFor(propName);
          if (rule) push(rule, `${objName}.${propName}`, node);
          if (WINDOW_YIELDING_PROPS.has(propName)) push("host-access", `${objName}.${propName}`, node);
        }
        if (objName === "document" && propName === "cookie") push("storage", "document.cookie", node);
        if (objName === "document" && propName === "defaultView") push("host-access", "document.defaultView", node);
        if (objName === "navigator" && propName === "sendBeacon") push("network", "navigator.sendBeacon", node);
      } else if (node.computed === true && objIsWindowLike) {
        // Fail-closed: dynamic/non-foldable computed access on a window receiver (window[expr]).
        push("host-access", `${objName}[…] (dynamic)`, node);
      }
    }

    // Bare forbidden identifier reference (skip name positions). Covers eval, fetch, parent,
    // localStorage, Reflect, Proxy, … used as callee/argument/standalone/member-object.
    if (node.type === "Identifier" && !namePositions.has(node)) {
      const name = node.name as string;
      const rule = ruleFor(name);
      if (rule) push(rule, name, node);
    }
  };

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isNode(value)) return;
    markNamePositions(value);
    checkNode(value);
    for (const key of Object.keys(value)) {
      if (IGNORED_KEYS.has(key)) continue;
      walk((value as Record<string, unknown>)[key]);
    }
  };

  walk(ast);

  // De-duplicate identical (rule, detail, line) violations produced by overlapping checks.
  const seen = new Set<string>();
  const deduped = violations.filter((v) => {
    const key = `${v.rule}|${v.detail}|${v.line ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: deduped.length === 0, violations: deduped, syntaxErrors };
}

/** Mark every Identifier bound by a (possibly destructured) pattern as a name position. */
function markPatternIds(pattern: unknown, namePositions: WeakSet<AstNode>): void {
  if (!isNode(pattern)) return;
  switch (pattern.type) {
    case "Identifier":
      namePositions.add(pattern);
      return;
    case "AssignmentPattern":
      markPatternIds(pattern.left, namePositions);
      return;
    case "RestElement":
      markPatternIds(pattern.argument, namePositions);
      return;
    case "ArrayPattern": {
      const elements = pattern.elements;
      if (Array.isArray(elements)) for (const el of elements) markPatternIds(el, namePositions);
      return;
    }
    case "ObjectPattern": {
      const props = pattern.properties;
      if (Array.isArray(props)) {
        for (const p of props) {
          if (isNode(p) && p.type === "ObjectProperty") markPatternIds(p.value, namePositions);
          else markPatternIds(p, namePositions);
        }
      }
      return;
    }
    default:
      return;
  }
}
