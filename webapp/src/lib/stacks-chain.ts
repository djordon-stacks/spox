import type { ClaimsConfig, ClaimsNetworkName } from "./claims-config";

export interface StacksNodeInfo {
  burnBlockHeight: number;
  stacksTipHeight: number;
}

/** How often to refresh the burn tip on the claims UI. */
export function burnTipPollIntervalMs(network: ClaimsNetworkName): number {
  return network === "mainnet" ? 5 * 60_000 : 3 * 60_000;
}

/**
 * Read chain tip info from the Stacks node's `/v2/info` (via the configured
 * Stacks API base URL). `burn_block_height` is the Bitcoin tip the node sees.
 */
export async function fetchStacksNodeInfo(
  config: Pick<ClaimsConfig, "apiUrl">,
): Promise<StacksNodeInfo> {
  const base = config.apiUrl.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/v2/info`);
  } catch (e) {
    throw new Error(
      `Cannot reach the Stacks API at ${base}. Check that it is running and allows cross-origin requests.`,
      { cause: e },
    );
  }
  if (!response.ok) {
    throw new Error(
      `Stacks /v2/info failed via ${base}: HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as {
    burn_block_height?: number;
    stacks_tip_height?: number;
  };
  if (
    typeof body.burn_block_height !== "number" ||
    typeof body.stacks_tip_height !== "number"
  ) {
    throw new Error(`Stacks /v2/info via ${base} returned an unexpected body.`);
  }
  return {
    burnBlockHeight: body.burn_block_height,
    stacksTipHeight: body.stacks_tip_height,
  };
}
