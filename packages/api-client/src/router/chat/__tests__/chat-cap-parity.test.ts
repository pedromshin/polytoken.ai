/**
 * chat-cap-parity.test.ts — the TS half of the cross-language chat-turn-cap
 * parity contract (Wave 0.6). packages/billing/src/chat-cap-parity.json is
 * THE single source of truth for the cap numbers and the free-tier block
 * message; the Python suite asserts the listener mirror against the same
 * file. A one-sided edit to either language's constants reds exactly one
 * suite, pointing at the fixture.
 *
 * The fixture is read via fs (not an ESM JSON import) deliberately: this
 * package's tsconfig has no resolveJsonModule and a cross-package JSON import
 * would violate its rootDir — the runtime read keeps the typecheck gate
 * clean while still asserting against the committed bytes.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { entitlementsFor, type Tier } from "@polytoken/billing";

import { CHAT_TURN_CAP_MESSAGE } from "../turn-cap";

interface ChatCapParityFixture {
  readonly monthlyChatTurns: Readonly<Record<Tier, number | null>>;
  readonly capMessage: string;
}

const FIXTURE_URL = new URL(
  "../../../../../billing/src/chat-cap-parity.json",
  import.meta.url,
);

function loadFixture(): ChatCapParityFixture {
  const parsed = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("chat-cap-parity.json did not parse to an object");
  }
  return parsed as ChatCapParityFixture;
}

const TIERS: readonly Tier[] = ["free", "pro", "power"];

describe("chat-cap parity (TS side vs packages/billing/src/chat-cap-parity.json)", () => {
  const fixture = loadFixture();

  it("CHAT_TURN_CAP_MESSAGE equals the fixture's capMessage byte-for-byte", () => {
    expect(typeof fixture.capMessage).toBe("string");
    expect(CHAT_TURN_CAP_MESSAGE).toBe(fixture.capMessage);
  });

  it.each(TIERS)(
    "entitlementsFor('%s').monthlyChatTurns equals the fixture (null <-> null)",
    (tier) => {
      expect(fixture.monthlyChatTurns).toHaveProperty(tier);
      expect(entitlementsFor(tier).monthlyChatTurns).toBe(
        fixture.monthlyChatTurns[tier],
      );
    },
  );
});
