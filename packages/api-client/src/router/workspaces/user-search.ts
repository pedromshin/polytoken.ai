/**
 * user-search.ts — `workspaces.searchUsers` (vLAUNCH W65, PEDRO-CHECKLIST §5).
 *
 * Resolves "who do I add?" for the add-member surface: a signed-in caller
 * types >= 3 characters and gets back AT MOST 10 candidate users, matched by
 * EMAIL PREFIX or display-name substring against Supabase's `auth.users`
 * (the only user-identity store this app has — identity is session-derived
 * from Supabase auth everywhere, see trpc.ts).
 *
 * ## Enumeration posture (deliberate, reviewed)
 *   - `protectedProcedure` — anonymous callers never reach the directory.
 *   - Minimum 3 characters (Zod, after trim) — no one-letter harvest sweeps.
 *   - Hard cap of {@link USER_SEARCH_MAX_RESULTS} rows per call.
 *   - ILIKE wildcards in the term are ESCAPED ({@link escapeLikePattern}) so
 *     `%`/`_` cannot widen a match — the term is also always a bound
 *     parameter, never string-interpolated into SQL.
 *   - MINIMAL COLUMNS ONLY: id + email + display name. Nothing else from
 *     auth.users (no phone, no timestamps, no metadata blob) ever leaves.
 *   - The caller is excluded from their own results (you never add yourself).
 *
 * Search is intentionally directory-wide (NOT workspace-scoped): its purpose
 * is finding people who are not members yet. The privileged act — actually
 * adding them — stays behind `addMember`'s admin+ RBAC.
 */

import { and, asc, ilike, isNotNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { AuthUsers } from "@polytoken/db/schema";

import { protectedProcedure } from "../../trpc";

/** Minimum query length (post-trim) — mirrored by the web add-member surface. */
export const USER_SEARCH_MIN_QUERY = 3;

/** Hard cap on rows per search call. */
export const USER_SEARCH_MAX_RESULTS = 10;

/**
 * escapeLikePattern — neutralise LIKE/ILIKE metacharacters in a user-typed
 * term (`\`, `%`, `_`) so the pattern matches them literally. Postgres'
 * default LIKE escape character is backslash.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Display name as Supabase records it: OAuth providers (Google) write
 * `full_name` (and often `name`) into `raw_user_meta_data`. Projected as a
 * single string column so ONLY the name string crosses the wire — never the
 * metadata blob itself.
 */
const displayName = sql<string | null>`coalesce(${AuthUsers.rawUserMetaData} ->> 'full_name', ${AuthUsers.rawUserMetaData} ->> 'name')`;

export const searchUsers = protectedProcedure
  .input(
    z.object({
      query: z.string().trim().min(USER_SEARCH_MIN_QUERY).max(100),
    }),
  )
  .query(async ({ ctx, input }) => {
    const escaped = escapeLikePattern(input.query);

    const rows = await ctx.db
      .select({
        id: AuthUsers.id,
        email: AuthUsers.email,
        name: displayName,
      })
      .from(AuthUsers)
      .where(
        and(
          // Never surface the caller to themselves.
          ne(AuthUsers.id, ctx.user.id),
          // Email-less identities (e.g. phone signups) are unaddable noise.
          isNotNull(AuthUsers.email),
          or(
            ilike(AuthUsers.email, `${escaped}%`),
            sql`${displayName} ILIKE ${`%${escaped}%`}`,
          ),
        ),
      )
      .orderBy(asc(AuthUsers.email))
      .limit(USER_SEARCH_MAX_RESULTS);

    return rows;
  });
