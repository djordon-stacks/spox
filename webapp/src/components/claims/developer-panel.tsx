"use client";

import { useClaimsConfig } from "@/components/claims/claims-config-provider";
import type { ClaimsNetworkName } from "@/lib/claims-config";
import {
  defaultApiUrlForNetwork,
  getDefaultClaimsConfig,
} from "@/lib/claims-config";

const NETWORKS: ClaimsNetworkName[] = ["devnet", "testnet", "mainnet"];

export function DeveloperPanel() {
  const { config, setDeveloperMode, updateOverrides, resetOverrides } =
    useClaimsConfig();
  const defaults = getDefaultClaimsConfig();
  const networkApiDefault = defaultApiUrlForNetwork(config.network);

  if (!config.developerMode) {
    return (
      <div className="claims-dev-collapsed">
        <button
          type="button"
          className="claims-dev-toggle"
          onClick={() => setDeveloperMode(true)}
        >
          Developer mode
        </button>
      </div>
    );
  }

  return (
    <section className="claims-dev-panel" aria-label="Developer settings">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="claims-dev-title">Developer settings</h2>
        <button
          type="button"
          className="claims-dev-toggle"
          onClick={() => setDeveloperMode(false)}
        >
          Turn off
        </button>
      </div>
      <p className="claims-hint mb-4">
        These overrides will replace the defaults while developer mode is on.
        Changing network switches to that network&apos;s Stacks API unless you
        set a custom URL.
      </p>

      <div className="space-y-4">
        <label className="claims-field">
          <span>Network</span>
          <select
            className="claims-input"
            value={config.network}
            onChange={(e) =>
              updateOverrides({
                network: e.target.value as ClaimsNetworkName,
                // Drop a prior custom API so the new network default applies.
                apiUrl: "",
              })
            }
          >
            {NETWORKS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="claims-field">
          <span>Stacks API URL</span>
          <input
            className="claims-input font-mono"
            type="url"
            placeholder={networkApiDefault}
            value={config.overrides.apiUrl ?? ""}
            onChange={(e) => updateOverrides({ apiUrl: e.target.value })}
          />
          <span className="claims-field-hint">
            Leave blank to use the {config.network} default (
            <code>{networkApiDefault}</code>).
          </span>
        </label>

        <label className="claims-field">
          <span>Claims registry contract</span>
          <input
            className="claims-input font-mono"
            type="text"
            placeholder={
              defaults.claimsContract || "ST….reward-claim-registry"
            }
            value={config.overrides.claimsContract ?? ""}
            onChange={(e) =>
              updateOverrides({ claimsContract: e.target.value })
            }
          />
          <span className="claims-field-hint">
            Leave blank for the build-time contract. Set this when the network
            you selected uses a different deployment.
          </span>
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="claims-btn-ghost"
            onClick={resetOverrides}
          >
            Reset overrides
          </button>
          <p className="claims-hint self-center">
            Active: {config.network} · {config.apiUrl}
          </p>
        </div>
      </div>
    </section>
  );
}
