"use client";

/**
 * Daemon connection config (token + port) as React state, hydration-safe.
 *
 * localStorage is read in an effect — never during render — so the server-rendered HTML
 * and the first client render agree ("unconfigured"), and the real config lands one paint
 * later. `loaded` lets surfaces avoid flashing the teaching state at a user who already
 * has a token saved.
 */
import { useCallback, useEffect, useState } from "react";

import {
  readDaemonConfig,
  writeDaemonToken,
  type DaemonConfig,
} from "../_lib/daemon-client";

export type DaemonConfigState = DaemonConfig & {
  /** False until the post-mount localStorage read has happened. */
  readonly loaded: boolean;
  readonly saveToken: (token: string) => void;
};

export function useDaemonConfig(): DaemonConfigState {
  const [config, setConfig] = useState<DaemonConfig & { loaded: boolean }>({
    token: null,
    port: 8787,
    loaded: false,
  });

  useEffect(() => {
    setConfig({ ...readDaemonConfig(), loaded: true });
  }, []);

  const saveToken = useCallback((token: string) => {
    writeDaemonToken(token);
    setConfig({ ...readDaemonConfig(), loaded: true });
  }, []);

  return { ...config, saveToken };
}
