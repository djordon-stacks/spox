"use client";

import { useCallback, useEffect, useState } from "react";
import { useClaimsConfig } from "@/components/claims/claims-config-provider";
import {
  burnTipPollIntervalMs,
  fetchStacksNodeInfo,
} from "@/lib/stacks-chain";

export function useBurnChainTip() {
  const { config, ready } = useClaimsConfig();
  const [burnBlockHeight, setBurnBlockHeight] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const info = await fetchStacksNodeInfo(config);
      setBurnBlockHeight(info.burnBlockHeight);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config, ready]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const id = window.setInterval(
      () => void refresh(),
      burnTipPollIntervalMs(config.network),
    );
    return () => window.clearInterval(id);
  }, [ready, refresh, config.network]);

  return { burnBlockHeight, error, loading, refresh };
}
