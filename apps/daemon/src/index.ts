/**
 * The daemon entrypoint: `tsx src/index.ts` (or `npm run dev -w @polytoken/daemon`).
 *
 * Requires:
 * - env `DAEMON_TOKEN` (≥16 chars) — refuses to start without it (DMON-01).
 * - `daemon.config.json` beside this package (copy `daemon.config.example.json`), or env
 *   `DAEMON_CONFIG` pointing at one.
 *
 * The boot log names the host, port and root COUNT. It never logs the token — not even a prefix,
 * not even a length (T-65-16). Logs get pasted into issues.
 */
import { loadConfig } from "./config.js";
import { readDaemonToken } from "./server/auth.js";
import { startDaemon } from "./server/daemon.js";

const main = async (): Promise<void> => {
  // Token first: fail before touching the filesystem if the gate is missing.
  const token = readDaemonToken(process.env);
  const config = loadConfig();

  const handle = await startDaemon({ config, token });

  console.log(
    `[daemon] listening on ws://${handle.address}:${handle.port} · ` +
      `roots=${config.roots.length} · watching ${config.watch.root}`,
  );
  console.log(`[daemon] permission state: ${config.stateDir}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[daemon] ${signal} received — shutting down`);
    await handle.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((error: unknown) => {
  // An actionable message, never a stack dump of secrets.
  console.error((error as Error).message);
  process.exit(1);
});
