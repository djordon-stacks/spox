"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearOverrides,
  readDeveloperMode,
  readOverrides,
  resolveClaimsConfig,
  writeDeveloperMode,
  writeOverrides,
  type ClaimsConfig,
  type ClaimsOverrides,
} from "@/lib/claims-config";

interface ClaimsConfigContextValue {
  config: ClaimsConfig;
  setDeveloperMode: (enabled: boolean) => void;
  updateOverrides: (patch: ClaimsOverrides) => void;
  resetOverrides: () => void;
  ready: boolean;
}

const ClaimsConfigContext = createContext<ClaimsConfigContextValue | null>(
  null,
);

export function ClaimsConfigProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [developerMode, setDevModeState] = useState(false);
  const [overrides, setOverridesState] = useState<ClaimsOverrides>({});

  useEffect(() => {
    setDevModeState(readDeveloperMode());
    setOverridesState(readOverrides());
    setReady(true);
  }, []);

  const setDeveloperMode = useCallback((enabled: boolean) => {
    writeDeveloperMode(enabled);
    setDevModeState(enabled);
  }, []);

  const updateOverrides = useCallback((patch: ClaimsOverrides) => {
    setOverridesState((prev) => {
      const next = { ...prev, ...patch };
      // Allow clearing individual fields with empty string.
      if (patch.apiUrl === "") delete next.apiUrl;
      if (patch.claimsContract === "") delete next.claimsContract;
      writeOverrides(next);
      return next;
    });
  }, []);

  const resetOverrides = useCallback(() => {
    clearOverrides();
    setOverridesState({});
  }, []);

  const config = useMemo(
    () => resolveClaimsConfig(developerMode, overrides),
    [developerMode, overrides],
  );

  const value = useMemo(
    () => ({
      config,
      setDeveloperMode,
      updateOverrides,
      resetOverrides,
      ready,
    }),
    [config, setDeveloperMode, updateOverrides, resetOverrides, ready],
  );

  return (
    <ClaimsConfigContext.Provider value={value}>
      {children}
    </ClaimsConfigContext.Provider>
  );
}

export function useClaimsConfig() {
  const ctx = useContext(ClaimsConfigContext);
  if (!ctx) {
    throw new Error("useClaimsConfig must be used within ClaimsConfigProvider");
  }
  return ctx;
}
