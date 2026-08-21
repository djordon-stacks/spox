"use client";

import { useState } from "react";
import { useWallet } from "@/components/wallet-provider";

export function ClaimsConnectButton() {
  const { connected, stxAddress, connect, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  if (connected && stxAddress) {
    const onCopy = () => {
      navigator.clipboard.writeText(stxAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="claims-addr"
          title={stxAddress}
        >
          <span className="claims-addr-dot" />
          <span className="font-mono text-xs">
            {stxAddress.slice(0, 6)}…{stxAddress.slice(-4)}
          </span>
          <span className="sr-only">{copied ? "Copied" : "Copy address"}</span>
        </button>
        <button type="button" onClick={disconnect} className="claims-btn-ghost">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={connect} className="claims-btn-secondary">
      Connect wallet
    </button>
  );
}
