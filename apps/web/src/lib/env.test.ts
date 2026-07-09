/**
 * env.test.ts — unit tests for parseEnv, the Zod boundary that fails
 * startup fast with a clear, var-naming message when a required auth env
 * var is missing (AUTH-05), and proves the public/secret var split holds
 * (T-43-P1-01, T-43-P1-02).
 */

import { describe, expect, it } from "vitest";

import { envSchema, parseEnv } from "./env";

const VALID_SOURCE = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
  EMAIL_LISTENER_URL: "https://listener.example.com",
  EMAIL_LISTENER_API_KEY: "listener-api-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-public-key",
};

describe("parseEnv", () => {
  it("throws with a message naming the missing var when NEXT_PUBLIC_SUPABASE_ANON_KEY is absent", () => {
    const { NEXT_PUBLIC_SUPABASE_ANON_KEY: _omit, ...incomplete } =
      VALID_SOURCE;

    expect(() => parseEnv(incomplete)).toThrow(
      /Missing\/invalid auth environment variables:.*NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it("returns a typed object when all vars are present", () => {
    const result = parseEnv(VALID_SOURCE);

    expect(result).toEqual(VALID_SOURCE);
  });

  it("keeps public and secret var sets disjoint — no NEXT_PUBLIC_ key carries the service-role value", () => {
    // Schema-level: no key in the schema's own shape both starts with
    // NEXT_PUBLIC_ and is the service-role key itself.
    const schemaKeys = Object.keys(envSchema.shape);
    const publicKeys = schemaKeys.filter((key) =>
      key.startsWith("NEXT_PUBLIC_"),
    );
    expect(publicKeys).not.toContain("SUPABASE_SERVICE_ROLE_KEY");

    // Value-level: parsing a source where the secret and the public keys
    // hold different values must never let the secret leak onto a
    // NEXT_PUBLIC_ field.
    const parsed = parseEnv(VALID_SOURCE);
    for (const key of publicKeys) {
      expect(parsed[key as keyof typeof parsed]).not.toBe(
        VALID_SOURCE.SUPABASE_SERVICE_ROLE_KEY,
      );
    }
  });
});
