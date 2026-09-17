"use client";

import { useState } from "react";
import { useWallet } from "@/components/wallet-provider";

export function ClaimsConnectButton() {
  const { connected, stxAddress, connect, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  if (connected && stxAddress) {
    const onCopy = () => {
      void navigator.clipboard.writeText(stxAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };

    return (
      <details className="claims-menu claims-menu-end">
        <summary className="claims-menu-summary claims-addr" title={stxAddress}>
          <span className="claims-addr-dot" />
          <span className="font-mono text-xs">
            {stxAddress.slice(0, 6)}…{stxAddress.slice(-4)}
          </span>
          <span className="claims-menu-chevron" aria-hidden="true" />
        </summary>
        <div className="claims-menu-panel">
          <button type="button" className="claims-menu-item" onClick={onCopy}>
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            type="button"
            className="claims-menu-item"
            onClick={disconnect}
          >
            Disconnect
          </button>
        </div>
      </details>
    );
  }

  return (
    <button type="button" onClick={connect} className="claims-btn-secondary">
      Connect
    </button>
  );
}
