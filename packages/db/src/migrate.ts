import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { env } from "./client";

const { Pool } = pg;

const runMigrate = async (): Promise<void> => {
  if (!env.POSTGRES_URL_NON_POOLING) {
    throw new Error("POSTGRES_URL_NON_POOLING is not defined");
  }

  // Use the non-pooling URL for direct PostgreSQL connection
  const connectionString = env.POSTGRES_URL_NON_POOLING;
  console.log("Using non-pooling connection for migrations");

  const pool = new Pool({ connectionString });

  try {
    // A single dedicated connection for the whole run: extension setup, the
    // optional BACKFILL_USER_ID session GUC, and the migration transaction
    // itself must all share one Postgres session so the 0032 backfill
    // migration's `current_setting('app.backfill_user_id', true)` can see
    // whatever was SET here (Phase 44, D-05). Using the pool directly for
    // `drizzle()` would let the migration transaction run on a different
    // connection than the one the GUC was set on.
    const client = await pool.connect();

    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
      console.log("✅ Extensions verified (vector, uuid-ossp, pg_trgm)");

      if (env.BACKFILL_USER_ID) {
        await client.query("SET app.backfill_user_id = $1", [
          env.BACKFILL_USER_ID,
        ]);
        console.log(
          `⚠️  BACKFILL_USER_ID override active: ${env.BACKFILL_USER_ID}`,
        );
      }

      const db = drizzle(client);

      console.log("⏳ Running migrations...");
      const start = Date.now();

      await migrate(db, { migrationsFolder: "migrations" });

      const end = Date.now();

      // Verify tables were created
      const result = await client.query(
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
      );
      const tableCount =
        (result.rows[0] as { count: number } | undefined)?.count ?? 0;
      console.log(
        `✅ Migrations completed in ${end - start}ms (${tableCount} tables)`,
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("❌ Migration failed");
    console.error(error);

    if (error instanceof Error) {
      if (
        error.message.includes("does not exist") ||
        error.message.includes("permission denied")
      ) {
        console.error("Possible causes:");
        console.error("- Missing database schema or permissions");
        console.error("- Connection to wrong database or environment");
        console.error("- Invalid Postgres URL");
      }

      if (error.message.includes("already exists")) {
        console.error(
          "Table or function already exists - you may need to drop it first",
        );
      }
    }

    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
};

console.log("Starting migration process...");
runMigrate().catch((err: unknown) => {
  console.error("❌ Migration failed with an unhandled error");
  console.error(err);
  process.exit(1);
});
