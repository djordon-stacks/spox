import { hexToCV, cvToJSON } from "@stacks/transactions";
import type { ClaimsConfig } from "./claims-config";

const PRINCIPAL_RE =
  /^S[PMTN][A-Z0-9]+(\.[A-Za-z][A-Za-z0-9_-]*)?$/i;

export interface RegistryContractEvent {
  txId: string;
  eventIndex: number;
  contractId: string;
  /** Decoded Clarity print payload (tuples become plain objects). */
  payload: Record<string, unknown>;
  /** Convenience: print `topic` when present. */
  topic: string | null;
  /** Convenience: `staker` principal when present. */
  staker: string | null;
  /** Convenience: `signer-manager` principal when present. */
  signerManager: string | null;
  /** All principal-looking string values in the payload (for filtering). */
  principals: string[];
  /** Original Clarity repr from the API, when provided. */
  repr: string | null;
}

interface RawContractEvent {
  event_index?: number;
  event_type?: string;
  tx_id?: string;
  contract_log?: {
    contract_id?: string;
    topic?: string;
    value?: { hex?: string; repr?: string };
  };
}

function unwrapJsonValue(node: unknown): unknown {
  if (
    node &&
    typeof node === "object" &&
    "value" in node &&
    Object.keys(node as object).length <= 3 &&
    ("type" in (node as object) || "value" in (node as object))
  ) {
    const typed = node as { type?: string; value: unknown };
    // Optional / some wrappers still have nested { type, value }.
    if (
      typed.type?.startsWith("(optional") ||
      typed.type === "optional" ||
      (typeof typed.type === "string" && typed.type.includes("optional"))
    ) {
      if (typed.value === null || typed.value === undefined) return null;
      return unwrapJsonValue(typed.value);
    }
    if (
      typed.value &&
      typeof typed.value === "object" &&
      !Array.isArray(typed.value) &&
      "type" in (typed.value as object)
    ) {
      // Tuple: value is a map of fields each with type/value
      const fields = typed.value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        out[k] = unwrapJsonValue(v);
      }
      return out;
    }
    return unwrapJsonValue(typed.value);
  }
  if (Array.isArray(node)) return node.map(unwrapJsonValue);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = unwrapJsonValue(v);
    }
    return out;
  }
  return node;
}

function collectPrincipals(
  value: unknown,
  into: string[],
): void {
  if (typeof value === "string") {
    if (PRINCIPAL_RE.test(value)) {
      into.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPrincipals(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectPrincipals(item, into);
    }
  }
}

export function decodeContractLogHex(hex: string): Record<string, unknown> {
  const json = cvToJSON(hexToCV(hex));
  const unwrapped = unwrapJsonValue(json);
  if (unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)) {
    return unwrapped as Record<string, unknown>;
  }
  return { value: unwrapped };
}

export function parseRegistryContractEvent(
  raw: RawContractEvent,
): RegistryContractEvent | null {
  if (raw.event_type !== "smart_contract_log") return null;
  const log = raw.contract_log;
  const hex = log?.value?.hex;
  if (!hex || !raw.tx_id) return null;

  let payload: Record<string, unknown>;
  try {
    payload = decodeContractLogHex(hex);
  } catch {
    payload = { repr: log?.value?.repr ?? null };
  }

  const principals: string[] = [];
  collectPrincipals(payload, principals);
  const topic =
    typeof payload.topic === "string" ? payload.topic : null;
  const staker =
    typeof payload.staker === "string" ? payload.staker : null;
  const signerManager =
    typeof payload["signer-manager"] === "string"
      ? payload["signer-manager"]
      : null;

  return {
    txId: raw.tx_id,
    eventIndex: raw.event_index ?? 0,
    contractId: log?.contract_id ?? "",
    payload,
    topic,
    staker,
    signerManager,
    principals,
    repr: log?.value?.repr ?? null,
  };
}

function looksLikePrincipal(value: string): boolean {
  return PRINCIPAL_RE.test(value);
}

function isContractPrincipal(value: string): boolean {
  return value.includes(".");
}

function principalMatchesFilter(principal: string, needle: string): boolean {
  const hay = principal.toUpperCase();
  if (hay === needle) return true;
  // Standard address matches a contract principal deployed from it.
  const addr = hay.split(".")[0] ?? hay;
  return addr === needle || hay.startsWith(`${needle}.`);
}

function textMatchesFilter(value: string | null, needle: string): boolean {
  if (!value) return false;
  return value.toUpperCase().includes(needle);
}

function matchesSignerManager(
  event: RegistryContractEvent,
  needle: string,
): boolean {
  return event.signerManager
    ? principalMatchesFilter(event.signerManager, needle)
    : false;
}

function matchesStaker(
  event: RegistryContractEvent,
  needle: string,
): boolean {
  return event.staker ? principalMatchesFilter(event.staker, needle) : false;
}

/**
 * Infer the filter from the input: a principal matches signer-manager
 * (contract principals first) then staker; anything else matches topic.
 */
export function eventMatchesFilter(
  event: RegistryContractEvent,
  filter: string,
): boolean {
  const raw = filter.trim();
  if (!raw) return true;
  const needle = raw.toUpperCase();

  if (looksLikePrincipal(raw)) {
    if (isContractPrincipal(raw)) {
      return matchesSignerManager(event, needle) || matchesStaker(event, needle);
    }
    return matchesStaker(event, needle) || matchesSignerManager(event, needle);
  }

  return textMatchesFilter(event.topic, needle);
}

export function eventMatchesPrincipal(
  event: RegistryContractEvent,
  filter: string,
): boolean {
  return eventMatchesFilter(event, filter);
}

export async function fetchRegistryContractEvents(
  config: Pick<ClaimsConfig, "apiUrl" | "claimsContract">,
  options: { limit?: number; offset?: number } = {},
): Promise<{ events: RegistryContractEvent[]; limit: number; offset: number }> {
  if (!config.claimsContract) {
    throw new Error("Claims registry contract is not configured.");
  }
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const base = config.apiUrl.replace(/\/$/, "");
  const url = `${base}/extended/v1/contract/${encodeURIComponent(config.claimsContract)}/events?limit=${limit}&offset=${offset}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new Error(
      `Cannot reach the Stacks API at ${base}. Check that it is running and allows cross-origin requests.`,
      { cause: e },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Contract events failed via ${base}: HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as {
    limit?: number;
    offset?: number;
    results?: RawContractEvent[];
  };
  const events = (body.results ?? [])
    .map(parseRegistryContractEvent)
    .filter((e): e is RegistryContractEvent => e !== null);

  return {
    events,
    limit: body.limit ?? limit,
    offset: body.offset ?? offset,
  };
}
