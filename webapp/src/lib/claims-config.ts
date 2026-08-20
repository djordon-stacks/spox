import {
  createNetwork,
  defaultUrlFromNetwork,
  type StacksNetwork,
  type StacksNetworkName,
} from "@stacks/network";
import { STACKS_NETWORK } from "./constants";

export type ClaimsNetworkName = "mainnet" | "testnet" | "devnet";

const VALID_NETWORKS: ClaimsNetworkName[] = ["mainnet", "testnet", "devnet"];

const STORAGE_DEV_MODE = "spox_claims_dev_mode";
const STORAGE_OVERRIDES = "spox_claims_overrides";

export interface ClaimsOverrides {
  network?: ClaimsNetworkName;
  apiUrl?: string;
  claimsContract?: string;
}

export interface ClaimsConfig {
  network: ClaimsNetworkName;
  apiUrl: string;
  claimsContract: string;
  stacksNetwork: StacksNetwork;
  developerMode: boolean;
  overrides: ClaimsOverrides;
  usingOverrides: boolean;
}

function parseNetwork(value: string | undefined): ClaimsNetworkName {
  if (value && VALID_NETWORKS.includes(value as ClaimsNetworkName)) {
    return value as ClaimsNetworkName;
  }
  return STACKS_NETWORK as ClaimsNetworkName;
}

/** Build-time defaults from env (used when developer mode is off). */
export function getDefaultClaimsConfig(): Omit<
  ClaimsConfig,
  "developerMode" | "overrides" | "usingOverrides"
> {
  const network = parseNetwork(process.env.NEXT_PUBLIC_NETWORK);
  const envApi = process.env.NEXT_PUBLIC_STACKS_API_URL?.trim();
  const apiUrl =
    envApi || defaultUrlFromNetwork(network as StacksNetworkName);
  const claimsContract =
    process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT?.trim() ?? "";

  return {
    network,
    apiUrl,
    claimsContract,
    stacksNetwork: createNetwork({
      network: network as StacksNetworkName,
      client: { baseUrl: apiUrl },
    }),
  };
}

export function readDeveloperMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_DEV_MODE) === "1";
}

export function writeDeveloperMode(enabled: boolean) {
  localStorage.setItem(STORAGE_DEV_MODE, enabled ? "1" : "0");
}

export function readOverrides(): ClaimsOverrides {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(STORAGE_OVERRIDES);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ClaimsOverrides;
    const overrides: ClaimsOverrides = {};
    if (
      parsed.network &&
      VALID_NETWORKS.includes(parsed.network as ClaimsNetworkName)
    ) {
      overrides.network = parsed.network;
    }
    if (typeof parsed.apiUrl === "string" && parsed.apiUrl.trim()) {
      overrides.apiUrl = parsed.apiUrl.trim();
    }
    if (
      typeof parsed.claimsContract === "string" &&
      parsed.claimsContract.trim()
    ) {
      overrides.claimsContract = parsed.claimsContract.trim();
    }
    return overrides;
  } catch {
    localStorage.removeItem(STORAGE_OVERRIDES);
    return {};
  }
}

export function writeOverrides(overrides: ClaimsOverrides) {
  const cleaned: ClaimsOverrides = {};
  if (overrides.network) cleaned.network = overrides.network;
  if (overrides.apiUrl?.trim()) cleaned.apiUrl = overrides.apiUrl.trim();
  if (overrides.claimsContract?.trim()) {
    cleaned.claimsContract = overrides.claimsContract.trim();
  }
  localStorage.setItem(STORAGE_OVERRIDES, JSON.stringify(cleaned));
}

export function clearOverrides() {
  localStorage.removeItem(STORAGE_OVERRIDES);
}

/** Resolve effective config from defaults + optional runtime overrides. */
export function resolveClaimsConfig(
  developerMode: boolean,
  overrides: ClaimsOverrides,
): ClaimsConfig {
  const defaults = getDefaultClaimsConfig();
  const usingOverrides = developerMode;
  const network =
    usingOverrides && overrides.network ? overrides.network : defaults.network;
  const apiUrl =
    usingOverrides && overrides.apiUrl ? overrides.apiUrl : defaults.apiUrl;
  const claimsContract =
    usingOverrides && overrides.claimsContract
      ? overrides.claimsContract
      : defaults.claimsContract;

  return {
    network,
    apiUrl,
    claimsContract,
    stacksNetwork: createNetwork({
      network: network as StacksNetworkName,
      client: { baseUrl: apiUrl },
    }),
    developerMode,
    overrides,
    usingOverrides,
  };
}

export function splitContractId(
  contractId: string,
): { address: string; name: string } | null {
  const trimmed = contractId.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  return {
    address: trimmed.slice(0, dot),
    name: trimmed.slice(dot + 1),
  };
}

export function stacksExplorerTxUrlForConfig(
  txId: string,
  config: Pick<ClaimsConfig, "network" | "apiUrl">,
): string {
  if (config.network === "devnet") {
    const api = encodeURIComponent(config.apiUrl);
    return `http://localhost:3020/txid/${txId}?chain=testnet&api=${api}`;
  }
  const base = "https://explorer.hiro.so";
  if (config.network === "mainnet") {
    return `${base}/txid/${txId}`;
  }
  return `${base}/txid/${txId}?chain=${config.network}`;
}

export const MICRO_STX = 1_000_000n;
export const MAX_CLAIM_CYCLES = 192n;

export function formatStxFromMicro(micro: bigint): string {
  const whole = micro / MICRO_STX;
  const frac = micro % MICRO_STX;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function parseStxToMicro(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * MICRO_STX + BigInt(frac.padEnd(6, "0"));
}

/** STX escrow for a whole number of prepaid claim installments. */
export function feeMicroForClaimCount(
  claimCount: bigint,
  feePerCycle: bigint,
): bigint {
  return claimCount * feePerCycle;
}

export function stacksExplorerContractUrlForConfig(
  contractId: string,
  config: Pick<ClaimsConfig, "network" | "apiUrl">,
): string | null {
  const trimmed = contractId.trim();
  if (!splitContractId(trimmed)) return null;

  if (config.network === "devnet") {
    const api = encodeURIComponent(config.apiUrl);
    return `http://localhost:3020/txid/${trimmed}?chain=testnet&api=${api}&ssr=false`;
  }

  const base = "https://explorer.hiro.so";
  if (config.network === "mainnet") {
    return `${base}/txid/${trimmed}`;
  }
  return `${base}/txid/${trimmed}?chain=${config.network}`;
}
