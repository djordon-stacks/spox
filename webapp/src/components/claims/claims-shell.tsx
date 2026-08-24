"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClaimsConnectButton } from "@/components/claims/claims-connect-button";
import {
  ClaimsPageMenu,
  type ClaimsNavPage,
} from "@/components/claims/claims-page-menu";
import { useClaimsConfig } from "@/components/claims/claims-config-provider";
import { useBurnChainTip } from "@/hooks/use-burn-chain-tip";
import { stacksExplorerContractUrlForConfig } from "@/lib/claims-config";

export type { ClaimsNavPage } from "@/components/claims/claims-page-menu";

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
        <ClaimsPageMenu active={active} />
        <div className="claims-nav-meta">
          <span
            className="claims-status-badge"
            title={
              tipError
                ? tipError
                : tipLoading && burnBlockHeight === null
                  ? "Loading Bitcoin tip…"
                  : "Network and Bitcoin burn height from Stacks /v2/info"
            }
          >
            {ready ? `${config.network} · ` : null}
            {burnBlockHeight !== null
              ? burnBlockHeight.toLocaleString()
              : tipLoading
                ? "…"
                : "—"}
          </span>
          <ClaimsConnectButton />
        </div>
      </header>

      <section className="claims-hero">
        <h1 className="sr-only">
          {active === "register"
            ? "Reward claims"
            : active === "activity"
              ? "Registry activity"
              : "About spox"}
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
          <Link href="/about/" className="claims-footer-link">
            About
          </Link>
          {" · "}
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
