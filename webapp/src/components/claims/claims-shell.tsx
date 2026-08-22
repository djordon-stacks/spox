"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClaimsConnectButton } from "@/components/claims/claims-connect-button";
import { useClaimsConfig } from "@/components/claims/claims-config-provider";
import { useBurnChainTip } from "@/hooks/use-burn-chain-tip";
import { stacksExplorerContractUrlForConfig } from "@/lib/claims-config";

export type ClaimsNavPage = "register" | "activity";

export function ClaimsShell({
  active,
  children,
  lede,
}: {
  active: ClaimsNavPage;
  children: ReactNode;
  lede: ReactNode;
}) {
  const { config, ready } = useClaimsConfig();
  const { burnBlockHeight, error: tipError, loading: tipLoading } =
    useBurnChainTip();
  const registryExplorerUrl =
    ready && config.claimsContract
      ? stacksExplorerContractUrlForConfig(config.claimsContract, config)
      : null;

  return (
    <main className="claims-page">
      <div className="claims-atmosphere" aria-hidden />

      <header className="claims-nav">
        <nav className="claims-nav-links" aria-label="Claims">
          <Link
            href="/"
            className={
              active === "register" ? "claims-nav-current" : "claims-nav-muted"
            }
          >
            Register
          </Link>
          <span className="claims-nav-sep" aria-hidden="true">
            ·
          </span>
          <Link
            href="/activity/"
            className={
              active === "activity" ? "claims-nav-current" : "claims-nav-muted"
            }
          >
            Activity
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          {ready && (
            <span className="claims-network-badge">{config.network}</span>
          )}
          <span
            className="claims-tip-badge"
            title={
              tipError
                ? tipError
                : tipLoading && burnBlockHeight === null
                  ? "Loading Bitcoin tip…"
                  : "Bitcoin burn block height from Stacks /v2/info"
            }
          >
            {burnBlockHeight !== null
              ? `BTC tip ${burnBlockHeight.toLocaleString()}`
              : tipLoading
                ? "BTC tip…"
                : "BTC tip —"}
          </span>
          <ClaimsConnectButton />
        </div>
      </header>

      <section className="claims-hero">
        <h1 className="sr-only">
          {active === "register" ? "Reward claims" : "Registry activity"}
        </h1>
        <p className="claims-brand" aria-hidden="true">
          spox
        </p>
        <p className="claims-lede">{lede}</p>
      </section>

      {children}

      <footer className="claims-footer">
        <p>All data is read from the Stacks blockchain.</p>
        {registryExplorerUrl && (
          <p>
            Registry contract{" "}
            <a
              href={registryExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="claims-footer-link font-mono"
            >
              {config.claimsContract}
            </a>
          </p>
        )}
        <p>
          Built with 🧡 at Stacks Labs{" "}
          <span className="claims-footer-sep" aria-hidden="true">
            ·
          </span>{" "}
          <a
            href="https://github.com/stx-labs/spox"
            target="_blank"
            rel="noopener noreferrer"
            className="claims-footer-link"
          >
            Source available on GitHub
          </a>
        </p>
      </footer>
    </main>
  );
}
