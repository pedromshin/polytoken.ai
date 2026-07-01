/**
 * validate-island-code.ts — host-side, pre-execution AST allowlist for code-island source.
 *
 * This is the PRIMARY deterministic safety layer for the jailed-eval code-island (Phase 20).
 * Before any generated code is injected into the sandboxed iframe, it is parsed and walked;
 * references to a blocklisted API surface (network egress, host/parent access, storage,
 * dynamic eval, module imports) are rejected. This runs ON TOP of the iframe `sandbox`
 * attribute + `<meta>` CSP (defense in depth) — the cheapest place to stop exfiltration is
 * before the code ever reaches the frame (see 20-RESEARCH.md §3, §5).
 *
 * Island code contract (spike): a plain JavaScript program string that runs inside the frame
 * against a fresh `document`. It may build any DOM/canvas UI ("raw HTML → anything" via JS).
 * Parsed as an ES module so `import`/`export` surface as nodes we can flag/strip.
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
  | "host-access";

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
const NETWORK = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
]);
const STORAGE = new Set(["localStorage", "sessionStorage", "indexedDB"]);
const HOST_ACCESS = new Set(["parent", "top", "opener", "frameElement"]);

const ALL_FORBIDDEN = new Set<string>([
  ...DYNAMIC_EVAL,
  ...NETWORK,
  ...STORAGE,
  ...HOST_ACCESS,
]);

// Window-like receivers: `window.fetch`, `self.parent`, `globalThis.localStorage`, …
const WINDOW_RECEIVERS = new Set(["window", "self", "globalThis"]);

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
  return null;
}

function lineOf(node: AstNode): number | null {
  const loc = node.loc as { start?: { line?: number } } | undefined;
  return loc?.start?.line ?? null;
}

/**
 * Validate island source against the API allowlist.
 *
 * Detection strategy (conservative — false positives are acceptable, they just route the
 * code to heal/reject rather than run):
 *  - `import`/`export`-from and dynamic `import()` → rule "import".
 *  - `require(...)` calls → rule "require".
 *  - any reference to a forbidden bare global → its category rule.
 *  - `window|self|globalThis.<forbidden>` member access → the forbidden property's category.
 *  - `document.cookie` → "storage"; `navigator.sendBeacon` → "network".
 * Identifiers in NAME positions (member `.prop`, object keys, declaration ids, params, import
 * specifiers, labels) are NOT treated as references.
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

  const violations: IslandViolation[] = [];
  const namePositions = new WeakSet<AstNode>();

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
      violations.push({ rule: "import", detail: node.type, line: lineOf(node) });
      return;
    }
    if (node.type === "Import") {
      violations.push({ rule: "import", detail: "import()", line: lineOf(node) });
      return;
    }

    // require(...) calls.
    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (isNode(callee) && callee.type === "Identifier" && callee.name === "require") {
        violations.push({ rule: "require", detail: "require()", line: lineOf(node) });
      }
    }

    // Member access on window-like receivers, document.cookie, navigator.sendBeacon.
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const obj = node.object;
      const prop = node.property;
      if (isNode(obj) && obj.type === "Identifier" && isNode(prop) && prop.type === "Identifier") {
        const objName = obj.name as string;
        const propName = prop.name as string;
        if (WINDOW_RECEIVERS.has(objName)) {
          const rule = ruleFor(propName);
          if (rule) violations.push({ rule, detail: `${objName}.${propName}`, line: lineOf(node) });
        }
        if (objName === "document" && propName === "cookie") {
          violations.push({ rule: "storage", detail: "document.cookie", line: lineOf(node) });
        }
        if (objName === "navigator" && propName === "sendBeacon") {
          violations.push({ rule: "network", detail: "navigator.sendBeacon", line: lineOf(node) });
        }
      }
    }

    // Bare forbidden identifier reference (skip name positions).
    if (node.type === "Identifier" && !namePositions.has(node)) {
      const name = node.name as string;
      if (ALL_FORBIDDEN.has(name)) {
        const rule = ruleFor(name);
        if (rule) violations.push({ rule, detail: name, line: lineOf(node) });
      }
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
