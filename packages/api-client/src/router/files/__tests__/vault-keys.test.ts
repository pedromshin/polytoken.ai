/**
 * vault-keys.test.ts — the security argument for D-66-07 (Phase 66 Plan 01
 * Task 1). "Path traversal is impossible BY CONSTRUCTION" is a claim; this
 * file is the evidence for it.
 *
 * WHY EVERY REJECTION CASE ASSERTS THE MESSAGE, NOT JUST `success === false`:
 * the rules overlap. ".." is caught by the dot-segment rule AND by the
 * trailing-period rule; a control character in a name with a leading space
 * trips two more. A test asserting only "it was rejected" would therefore
 * stay GREEN after the dot-segment refine — the traversal guard itself — was
 * deleted, because a neighbouring rule happens to cover the same string. That
 * is a test that asserts nothing while looking thorough, and the plan's
 * negative proof would have silently passed.
 *
 * Asserting the ISSUE MESSAGE makes each refine individually load-bearing:
 * remove any one rule and exactly its own case goes red.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_FOLDER_PLACEHOLDER,
  parseVaultPath,
  VAULT_NAME_RULES,
  VAULT_PATH_MAX_DEPTH,
  VaultNameSchema,
  VaultPathSchema,
  VaultSegmentSchema,
  vaultKey,
} from "../vault-keys";

/** The messages produced by a rejected parse. */
function messagesFor(input: unknown): string[] {
  const result = VaultSegmentSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.message);
}

describe("VaultSegmentSchema — what a name may not be", () => {
  it("rejects an empty name", () => {
    expect(messagesFor("")).toContain(VAULT_NAME_RULES.EMPTY);
  });

  it("rejects a name longer than 255 characters", () => {
    expect(messagesFor("a".repeat(256))).toContain(VAULT_NAME_RULES.TOO_LONG);
  });

  it('rejects the dot segment ".." — the traversal classic', () => {
    // THE assertion the whole plan exists for. Message-level, so deleting the
    // dot-segment refine cannot be masked by the trailing-period rule.
    expect(messagesFor("..")).toContain(VAULT_NAME_RULES.DOT_SEGMENT);
  });

  it('rejects the dot segment "."', () => {
    expect(messagesFor(".")).toContain(VAULT_NAME_RULES.DOT_SEGMENT);
  });

  it('rejects a forward slash — separator smuggling', () => {
    expect(messagesFor("a/b")).toContain(VAULT_NAME_RULES.SEPARATOR);
    expect(messagesFor("../../etc/passwd")).toContain(VAULT_NAME_RULES.SEPARATOR);
  });

  it("rejects a backslash — the same smuggling on the other platform", () => {
    expect(messagesFor("a\\b")).toContain(VAULT_NAME_RULES.SEPARATOR);
  });

  it("rejects a NUL byte — the truncation classic", () => {
    expect(messagesFor("safe.txt\u0000.exe")).toContain(
      VAULT_NAME_RULES.CONTROL_CHAR,
    );
  });

  it("rejects a newline — header/log injection", () => {
    expect(messagesFor("a\nb")).toContain(VAULT_NAME_RULES.CONTROL_CHAR);
    expect(messagesFor("a\u007Fb")).toContain(VAULT_NAME_RULES.CONTROL_CHAR);
  });

  it("rejects the reserved placeholder — it is our bookkeeping, not a name", () => {
    expect(messagesFor(EMPTY_FOLDER_PLACEHOLDER)).toContain(
      VAULT_NAME_RULES.RESERVED,
    );
  });

  it("rejects a leading or trailing space — these round-trip badly", () => {
    expect(messagesFor(" invoice.pdf")).toContain(VAULT_NAME_RULES.EDGE_SPACE);
    expect(messagesFor("invoice.pdf ")).toContain(VAULT_NAME_RULES.EDGE_SPACE);
  });

  it("rejects a trailing period — the user could not address it later", () => {
    expect(messagesFor("report.")).toContain(VAULT_NAME_RULES.TRAILING_DOT);
  });

  it("rejects a non-string", () => {
    expect(VaultSegmentSchema.safeParse(42).success).toBe(false);
    expect(VaultSegmentSchema.safeParse(null).success).toBe(false);
  });
});

describe("VaultSegmentSchema — what a name MAY be", () => {
  // A vault that rejects the user's own language is broken. These are the
  // cases a paranoid regex breaks first, so they are pinned.
  it.each([
    "invoice.pdf",
    "Q3 reports",
    "a-file_name.v2.tar.gz",
    "a".repeat(255),
    "relatório.pdf",
    "日本語.txt",
    "Ünicode — em dash & ampersand",
    ".hidden-but-legal",
    "emptyFolderPlaceholder",
  ])("accepts %j", (name) => {
    const result = VaultSegmentSchema.safeParse(name);
    expect(
      result.success,
      `rejected a legitimate name: ${JSON.stringify(name)} -> ${messagesFor(name).join("; ")}`,
    ).toBe(true);
  });

  it("VaultNameSchema is the same schema, aliased for call-site readability", () => {
    expect(VaultNameSchema.safeParse("invoice.pdf").success).toBe(true);
    expect(VaultNameSchema.safeParse("..").success).toBe(false);
  });
});

describe("VaultPathSchema", () => {
  it("defaults to the vault root", () => {
    expect(VaultPathSchema.parse(undefined)).toEqual([]);
  });

  it("accepts a nested path", () => {
    expect(VaultPathSchema.parse(["docs", "2026"])).toEqual(["docs", "2026"]);
  });

  it("caps depth so a crafted deep path cannot be a listing amplifier", () => {
    const atCap = Array.from({ length: VAULT_PATH_MAX_DEPTH }, () => "a");
    expect(VaultPathSchema.safeParse(atCap).success).toBe(true);
    expect(VaultPathSchema.safeParse([...atCap, "a"]).success).toBe(false);
  });

  it("rejects a path containing ANY invalid segment", () => {
    expect(VaultPathSchema.safeParse(["docs", ".."]).success).toBe(false);
    expect(VaultPathSchema.safeParse(["docs", "a/b"]).success).toBe(false);
  });
});

describe("vaultKey — the single chokepoint", () => {
  it("returns the user's own root for an empty path", () => {
    expect(vaultKey("u1", [])).toBe("u1");
  });

  it("joins validated segments under the user's prefix", () => {
    expect(vaultKey("u1", ["a", "b.txt"])).toBe("u1/a/b.txt");
  });

  it("THE TENANCY TEST: a traversal payload throws, and nothing reaches user b", () => {
    // The classic, explicitly. `vaultKey` re-parses rather than trusting its
    // caller — this is what makes D-66-07 structural instead of a promise
    // about call order.
    expect(() => vaultKey("u1", ["..", "..", "u2", "secret.pdf"])).toThrow();

    // Stated the other way round, because "it threw" and "it could never
    // address u2" are different claims and only the second one is the
    // guarantee. There is no input for which vaultKey returns a u2 key.
    for (const payload of [
      ["..", "u2"],
      ["../../u2"],
      ["..\\..\\u2"],
      ["u2/secret.pdf"],
      [EMPTY_FOLDER_PLACEHOLDER],
      ["a\u0000/../u2"],
    ]) {
      let returned: string | null = null;
      try {
        returned = vaultKey("u1", payload);
      } catch {
        returned = null;
      }
      expect(
        returned === null || returned.startsWith("u1/") || returned === "u1",
        `vaultKey escaped its own user's prefix for ${JSON.stringify(payload)}: ${returned}`,
      ).toBe(true);
    }
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
  ])("throws on a %s userId — a fail-open guard (%s)", (userId) => {
    // A bug upstream that loses the user must NOT silently address the bucket
    // ROOT, which is every user's data at once. This is the difference between
    // one broken request and a cross-tenant listing.
    expect(() => vaultKey(userId, ["a.txt"])).toThrow();
  });

  it("throws on every name the schema rejects — it re-validates, it does not trust", () => {
    for (const bad of ["", "..", ".", "a/b", "a\\b", "a\u0000b", " x", "x.", EMPTY_FOLDER_PLACEHOLDER]) {
      expect(() => vaultKey("u1", [bad]), `accepted: ${JSON.stringify(bad)}`).toThrow();
    }
  });
});

describe("parseVaultPath — the URL decoder (?path=a/b)", () => {
  it("splits a well-formed path", () => {
    expect(parseVaultPath("docs/2026")).toEqual(["docs", "2026"]);
  });

  it("drops empty segments from sloppy but honest input", () => {
    expect(parseVaultPath("/docs//2026/")).toEqual(["docs", "2026"]);
  });

  it("returns the vault ROOT for anything invalid — never an error page", () => {
    // A hand-edited URL is the root. Not a crash, not a traversal.
    expect(parseVaultPath("../../etc")).toEqual([]);
    expect(parseVaultPath(null)).toEqual([]);
    expect(parseVaultPath("")).toEqual([]);
    expect(parseVaultPath("a\u0000b")).toEqual([]);
    expect(parseVaultPath(Array.from({ length: 40 }, () => "a").join("/"))).toEqual([]);
  });
});
