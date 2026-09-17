import {
  ClarityType,
  Cl,
  fetchCallReadOnlyFunction,
  type ClarityValue,
  type TupleCV,
} from "@stacks/transactions";
import {
  splitContractId,
  isValidContractPrincipal,
  pox5ContractForNetwork,
  traitImplementationUrl,
  type ClaimsConfig,
} from "./claims-config";

export interface StakerPosition {
  signer: string;
  firstRewardCycle: bigint;
  bondIndex: bigint | null;
}

export interface StakerRegistration {
  bondIndex: bigint | null;
  remainingClaims: bigint;
  oneClaimPerCycle: boolean;
  nextClaimDistribution: bigint;
  nextClaimBurnHeight: bigint | null;
  prepaidUstx: bigint;
}

function principalToString(cv: ClarityValue): string {
  if (
    cv.type === ClarityType.PrincipalStandard ||
    cv.type === ClarityType.PrincipalContract
  ) {
    return String(cv.value);
  }
  throw new Error(`Expected principal, got Clarity type ${cv.type}`);
}

function uintToBigInt(cv: ClarityValue): bigint {
  if (cv.type !== ClarityType.UInt) {
    throw new Error(`Expected uint, got Clarity type ${cv.type}`);
  }
  return BigInt(cv.value);
}

function optionalUint(cv: ClarityValue): bigint | null {
  if (cv.type === ClarityType.OptionalNone) return null;
  if (cv.type !== ClarityType.OptionalSome) {
    throw new Error(`Expected optional uint, got Clarity type ${cv.type}`);
  }
  return uintToBigInt(cv.value);
}

function boolValue(cv: ClarityValue): boolean {
  if (cv.type === ClarityType.BoolTrue) return true;
  if (cv.type === ClarityType.BoolFalse) return false;
  throw new Error(`Expected bool, got Clarity type ${cv.type}`);
}

function optionalTuple(
  cv: ClarityValue,
  functionName: string,
): TupleCV | null {
  if (cv.type === ClarityType.OptionalNone) return null;
  if (cv.type !== ClarityType.OptionalSome) {
    throw new Error(`Unexpected ${functionName} response type ${cv.type}`);
  }
  const inner = cv.value;
  if (inner.type !== ClarityType.Tuple) {
    throw new Error(`${functionName} some value was not a tuple`);
  }
  return inner as TupleCV;
}

async function callReadOnly(
  config: ClaimsConfig,
  contractId: string,
  functionName: string,
  functionArgs: ClarityValue[],
  senderAddress: string,
): Promise<ClarityValue> {
  const parts = splitContractId(contractId);
  if (!parts) {
    throw new Error(`Contract identifier "${contractId}" is not set or malformed.`);
  }

  try {
    return await fetchCallReadOnlyFunction({
      contractAddress: parts.address,
      contractName: parts.name,
      functionName,
      functionArgs,
      senderAddress,
      network: config.stacksNetwork,
    });
  } catch (e) {
    throw new Error(describeReadOnlyError(e, config, contractId, functionName), {
      cause: e,
    });
  }
}

/**
 * The node answers a read-only call with `okay: false` and a Clarity `cause`
 * for contract-level problems, which surfaces here as a thrown error just like
 * a transport failure. Only the latter means the endpoint is unreachable.
 */
function describeReadOnlyError(
  error: unknown,
  config: ClaimsConfig,
  contractId: string,
  functionName: string,
): string {
  const endpoint = `${config.apiUrl} (network: ${config.network})`;

  if (error instanceof TypeError) {
    return `Cannot reach the Stacks API at ${endpoint}. Check that it is running and allows cross-origin requests from this page.`;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("NoSuchContract")) {
    return `The registry contract has not been deployed. `;
  }
  if (message.includes("UndefinedFunction")) {
    return `Contract ${contractId} has no read-only function "${functionName}".`;
  }

  return `Read-only call "${functionName}" on ${contractId} failed via ${endpoint}: ${message}`;
}

/** Fee per claim installment in micro-STX. */
export async function fetchFeePerClaim(
  config: ClaimsConfig,
  senderAddress: string,
): Promise<bigint> {
  const result = await callReadOnly(
    config,
    config.claimsContract,
    "get-fee-per-claim",
    [],
    senderAddress,
  );
  return uintToBigInt(result);
}

/** Resolve the staker's live position directly from the boot pox-5 contract. */
export async function fetchPosition(
  config: ClaimsConfig,
  staker: string,
): Promise<StakerPosition | null> {
  const pox5 = pox5ContractForNetwork(config.network);
  const membership = optionalTuple(
    await callReadOnly(
      config,
      pox5,
      "get-bond-membership",
      [Cl.principal(staker)],
      staker,
    ),
    "get-bond-membership",
  );

  if (membership) {
    const bondIndex = uintToBigInt(membership.value["bond-index"]);
    const firstRewardCycle = uintToBigInt(
      await callReadOnly(
        config,
        pox5,
        "bond-period-to-reward-cycle",
        [Cl.uint(bondIndex)],
        staker,
      ),
    );
    return {
      signer: principalToString(membership.value.signer),
      firstRewardCycle,
      bondIndex,
    };
  }

  const stakerInfo = optionalTuple(
    await callReadOnly(
      config,
      pox5,
      "get-staker-info",
      [Cl.principal(staker)],
      staker,
    ),
    "get-staker-info",
  );

  if (!stakerInfo) return null;

  return {
    signer: principalToString(stakerInfo.value.signer),
    firstRewardCycle: uintToBigInt(
      stakerInfo.value["first-reward-cycle"],
    ),
    bondIndex: null,
  };
}

/** Look up a registry row for `{staker, signer-manager}`. */
export async function fetchRegistration(
  config: ClaimsConfig,
  staker: string,
  signerManager: string,
): Promise<StakerRegistration | null> {
  if (!config.claimsContract) {
    throw new Error("Claims registry contract is not configured.");
  }

  const tuple = optionalTuple(
    await callReadOnly(
      config,
      config.claimsContract,
      "get-registration",
      [Cl.principal(staker), Cl.principal(signerManager)],
      staker,
    ),
    "get-registration",
  );
  if (!tuple) return null;

  const nextClaimDistribution = uintToBigInt(
    tuple.value["next-claim-distribution"],
  );
  // Claims are pending only when next-claim-distribution is strictly less than
  // pox-5's current-distribution-cycle, so the first eligible burn height is
  // the start of the following distribution.
  const eligibleDistribution = nextClaimDistribution + 1n;
  let nextClaimBurnHeight: bigint | null = null;
  try {
    nextClaimBurnHeight = uintToBigInt(
      await callReadOnly(
        config,
        pox5ContractForNetwork(config.network),
        "distribution-cycle-to-burn-height",
        [Cl.uint(eligibleDistribution)],
        staker,
      ),
    );
  } catch {
    nextClaimBurnHeight = null;
  }

  return {
    bondIndex: optionalUint(tuple.value["bond-index"]),
    remainingClaims: uintToBigInt(tuple.value["remaining-claims"]),
    oneClaimPerCycle: boolValue(tuple.value["one-claim-per-reward-cycle"]),
    nextClaimDistribution,
    nextClaimBurnHeight,
    prepaidUstx: uintToBigInt(tuple.value["prepaid-ustx"]),
  };
}

/**
 * Result of checking a signer-manager against `reward-claim-signer-manager-trait`
 * via the node's `/v2/traits/` RPC. `null` means the principal was not fully formed
 * and no request was made.
 */
export type SignerManagerTraitCheck =
  | "supported"
  | "not-implemented"
  | "not-found";

/**
 * Check whether a signer-manager contract implements `reward-claim-signer-manager-trait`
 * as defined in the configured registry.
 */
export async function fetchSignerManagerTraitCheck(
  config: ClaimsConfig,
  signerManager: string,
): Promise<SignerManagerTraitCheck | null> {
  if (!config.claimsContract) {
    throw new Error("Claims registry contract is not configured.");
  }

  if (!isValidContractPrincipal(signerManager)) {
    return null;
  }

  const url = traitImplementationUrl(config, signerManager);
  if (!url) {
    throw new Error(
      "Signer-manager must be a contract principal (address.contract-name).",
    );
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new Error(
      `Cannot reach the Stacks API at ${config.apiUrl} (network: ${config.network}).`,
      { cause: e },
    );
  }

  if (response.status === 404) {
    return "not-found";
  }

  if (!response.ok) {
    throw new Error(`Trait check failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { is_implemented?: boolean };
  return body.is_implemented === true ? "supported" : "not-implemented";
}
