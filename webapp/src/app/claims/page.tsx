"use client";

import { ClaimsConnectButton } from "@/components/claims/claims-connect-button";
import { DeveloperPanel } from "@/components/claims/developer-panel";
import { RegisterForm } from "@/components/claims/register-form";
import { useClaimsConfig } from "@/components/claims/claims-config-provider";
import { stacksExplorerContractUrlForConfig } from "@/lib/claims-config";

export default function ClaimsPage() {
  const { config, ready } = useClaimsConfig();
  const registryExplorerUrl =
    ready && config.claimsContract
      ? stacksExplorerContractUrlForConfig(config.claimsContract, config)
      : null;

  return (
    <main className="claims-page">
      <div className="claims-atmosphere" aria-hidden />

      <header className="claims-nav">
        <nav className="claims-nav-links">
          <span className="claims-nav-current">spox reward claims</span>
        </nav>
        <div className="flex items-center gap-3">
          {ready && (
            <span className="claims-network-badge">{config.network}</span>
          )}
          <ClaimsConnectButton />
        </div>
      </header>

      <section className="claims-hero">
        <h1 className="sr-only">Reward claims</h1>
        <p className="claims-brand" aria-hidden="true">
          spox
        </p>
        <p className="claims-lede">
          Register your stake. When rewards are ready, spox calls the contracts
          so you don&apos;t have to.{" "}
          <a
            href="https://docs.stacks.co/pox-5/development/rewards"
            target="_blank"
            rel="noopener noreferrer"
            className="claims-lede-link"
          >
            How pox-5 rewards work
          </a>
          .
        </p>
      </section>

      <RegisterForm />

      <DeveloperPanel />

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
