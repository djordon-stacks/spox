"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { request } from "@stacks/connect";
import { Cl, Pc, type ClarityValue, type PostCondition } from "@stacks/transactions";
import { useClaimsConfig } from "@/components/claims/claims-config-provider";
import { useWallet } from "@/components/wallet-provider";
import {
  fetchFeePerClaim,
  fetchPosition,
  fetchRegistration,
  type StakerRegistration,
} from "@/lib/claims-api";
import {
  MAX_CLAIM_INSTALLMENTS,
  feeMicroForClaimCount,
  formatStxFromMicro,
  parseStxToMicro,
  stacksExplorerTxUrlForConfig,
} from "@/lib/claims-config";

const BOOT_SENDER = "ST000000000000000000002AMW42H";

function FieldLabel({
  children,
  help,
}: {
  children: ReactNode;
  help: string;
}) {
  return (
    <span className="claims-field-label">
      <span>{children}</span>
      <span
        className="claims-tooltip"
        tabIndex={0}
        aria-label={help}
        data-tip={help}
      >
        ?
      </span>
    </span>
  );
}

function HelpTooltip({ help }: { help: string }) {
  return (
    <span
      className="claims-tooltip"
      tabIndex={0}
      aria-label={help}
      data-tip={help}
    >
      ?
    </span>
  );
}

function SummaryItem({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>
        <FieldLabel help={help}>{label}</FieldLabel>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

export function RegisterForm() {
  const { connected, stxAddress, connect } = useWallet();
  const { config } = useClaimsConfig();

  const [staker, setStaker] = useState("");
  const [signerManager, setSignerManager] = useState("");
  const [startCycle, setStartCycle] = useState("");
  const [oneClaimPerCycle, setOneClaimPerCycle] = useState(true);
  const [feeStx, setFeeStx] = useState("");
  const [claimCount, setClaimCount] = useState("");
  const claimCountRef = useRef(claimCount);
  claimCountRef.current = claimCount;
  const [feePerClaim, setFeePerClaim] = useState<bigint | null>(null);
  const [loadingFeeRate, setLoadingFeeRate] = useState(false);
  const [positionNote, setPositionNote] = useState("");
  const [positionFound, setPositionFound] = useState(false);
  const [registration, setRegistration] = useState<StakerRegistration | null>(
    null,
  );
  const [registrationNote, setRegistrationNote] = useState("");
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [loadingRegistration, setLoadingRegistration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState("");
  const [txId, setTxId] = useState<string | null>(null);

  const registered = registration !== null;
  const connectedIsStaker =
    Boolean(stxAddress) &&
    stxAddress?.toUpperCase() === staker.trim().toUpperCase();

  // Prefill staker from wallet.
  useEffect(() => {
    if (stxAddress) setStaker((prev) => prev || stxAddress);
  }, [stxAddress]);

  const refreshFeeRate = useCallback(async () => {
    if (!config.claimsContract) {
      setFeePerClaim(null);
      return;
    }
    setLoadingFeeRate(true);
    try {
      const fee = await fetchFeePerClaim(config, BOOT_SENDER);
      setFeePerClaim(fee);
    } catch {
      setFeePerClaim(null);
    } finally {
      setLoadingFeeRate(false);
    }
  }, [config]);

  useEffect(() => {
    void refreshFeeRate();
  }, [refreshFeeRate]);

  const clearRegistration = useCallback(() => {
    setRegistration(null);
    setRegistrationNote("");
    setConfirmingCancel(false);
  }, []);

  const loadDefaults = useCallback(async () => {
    if (!staker.trim()) {
      setError("Enter a staker address first.");
      return;
    }

    setLoadingDefaults(true);
    setError("");
    setPositionNote("");
    setPositionFound(false);
    clearRegistration();
    try {
      const [position, price] = await Promise.all([
        fetchPosition(config, staker.trim()),
        config.claimsContract
          ? fetchFeePerClaim(config, BOOT_SENDER).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (price !== null) setFeePerClaim(price);
      const feeNote =
        price === null
          ? " The registry fee is unavailable until the claims contract is deployed; enter the fee when it is known."
          : "";

      if (!position) {
        setSignerManager("");
        setStartCycle("");
        setPositionFound(false);
        setPositionNote(
          `No live pox-5 position found for this staker. Registration will fail until they stake under a signer-manager.${feeNote}`,
        );
        return;
      }

      // Bonded positions can claim twice per cycle; STX-only stakes claim once.
      const twicePerCycle = position.bondIndex !== null;
      setOneClaimPerCycle(!twicePerCycle);
      setSignerManager(position.signer);
      setStartCycle(position.firstRewardCycle.toString());
      setPositionFound(true);
      setPositionNote(
        twicePerCycle
          ? `Position found (bond index ${position.bondIndex}). Signer-manager, start cycle, and twice-per-cycle cadence filled directly from pox-5.${feeNote}`
          : `STX-only stake found. Signer-manager, start cycle, and once-per-cycle cadence filled directly from pox-5.${feeNote}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDefaults(false);
    }
  }, [clearRegistration, config, staker]);

  const loadRegistration = useCallback(async () => {
    if (!staker.trim()) {
      setError("Enter a staker address first.");
      return;
    }
    if (!signerManager.trim()) {
      setError(
        "Enter a signer-manager first. Load staking details to fill it from pox-5.",
      );
      return;
    }
    if (!config.claimsContract) {
      setError("Claims registry contract is not configured.");
      return;
    }

    setLoadingRegistration(true);
    setError("");
    setConfirmingCancel(false);
    setRegistrationNote("");
    setPositionNote("");
    setPositionFound(false);
    try {
      const [row, price] = await Promise.all([
        fetchRegistration(config, staker.trim(), signerManager.trim()),
        fetchFeePerClaim(config, BOOT_SENDER).catch(() => null),
      ]);
      if (price !== null) setFeePerClaim(price);

      if (!row) {
        setRegistration(null);
        setRegistrationNote(
          "No registration for this staker and signer-manager. You can register if this principal already has a live pox-5 stake under that signer-manager.",
        );
        return;
      }

      setRegistration(row);
      setOneClaimPerCycle(row.oneClaimPerCycle);
      setRegistrationNote(
        "Registration found. Add claims to top up prepaid installments, or cancel to refund remaining STX.",
      );
    } catch (e) {
      setRegistration(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRegistration(false);
    }
  }, [config, signerManager, staker]);

  const syncFeeFromClaimCount = useCallback(
    (countInput: string) => {
      setClaimCount(countInput);
      if (!feePerClaim) return;
      const parsed = Number.parseInt(countInput.trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setFeeStx("");
        return;
      }
      const capped = BigInt(Math.min(parsed, Number(MAX_CLAIM_INSTALLMENTS)));
      setFeeStx(
        formatStxFromMicro(feeMicroForClaimCount(capped, feePerClaim)),
      );
    },
    [feePerClaim],
  );

  const handleFeeStxChange = useCallback(
    (value: string) => {
      setFeeStx(value);
      if (!feePerClaim) return;
      const micro = parseStxToMicro(value);
      if (micro === null || micro <= 0n) {
        setClaimCount("");
        return;
      }
      const raw = micro / feePerClaim;
      setClaimCount(raw > 0n ? raw.toString() : "");
    },
    [feePerClaim],
  );

  useEffect(() => {
    const countInput = claimCountRef.current;
    if (!feePerClaim || !countInput.trim()) return;
    const parsed = Number.parseInt(countInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const capped = BigInt(Math.min(parsed, Number(MAX_CLAIM_INSTALLMENTS)));
    setFeeStx(
      formatStxFromMicro(feeMicroForClaimCount(capped, feePerClaim)),
    );
  }, [feePerClaim]);

  const feeMicro = useMemo(() => parseStxToMicro(feeStx), [feeStx]);

  const cyclesBought = useMemo(() => {
    if (feeMicro === null || feePerClaim === null || feePerClaim === 0n) {
      return null;
    }
    const raw = feeMicro / feePerClaim;
    return raw > MAX_CLAIM_INSTALLMENTS ? MAX_CLAIM_INSTALLMENTS : raw;
  }, [feeMicro, feePerClaim]);

  const submitContractCall = useCallback(
    async (args: {
      functionName: string;
      functionArgs: ClarityValue[];
      postConditions: PostCondition[];
      failed: string;
    }) => {
      if (!connected) {
        connect();
        return;
      }
      if (!config.claimsContract) {
        setError("Claims registry contract is not configured.");
        return;
      }

      setSubmitting(true);
      setError("");
      setTxId(null);
      try {
        const resp = await request("stx_callContract", {
          contract: config.claimsContract as `${string}.${string}`,
          functionName: args.functionName,
          functionArgs: args.functionArgs,
          network: config.network,
          postConditions: args.postConditions,
          postConditionMode: "deny",
        });
        setTxId(resp.txid ?? null);
        return true;
      } catch (e) {
        console.warn(`${args.functionName} failed`, e);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`${args.failed}: ${msg}`);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [connected, connect, config.claimsContract, config.network],
  );

  const handleRegister = useCallback(async () => {
    if (!staker.trim() || !signerManager.trim() || !startCycle.trim()) {
      setError("Staker, signer-manager, and start reward cycle are required.");
      return;
    }
    if (feeMicro === null || feeMicro <= 0n) {
      setError("Enter a valid fee in STX (up to 6 decimal places).");
      return;
    }
    let start: bigint;
    try {
      start = BigInt(startCycle.trim());
    } catch {
      setError("Start reward cycle must be an integer.");
      return;
    }

    await submitContractCall({
      functionName: "register-for-claims",
      functionArgs: [
        Cl.principal(staker.trim()),
        Cl.principal(signerManager.trim()),
        Cl.uint(start),
        Cl.bool(oneClaimPerCycle),
        Cl.uint(feeMicro),
      ],
      postConditions: [
        Pc.principal(stxAddress ?? staker.trim())
          .willSendLte(feeMicro)
          .ustx(),
      ],
      failed: "Registration failed",
    });
  }, [
    feeMicro,
    oneClaimPerCycle,
    signerManager,
    startCycle,
    staker,
    stxAddress,
    submitContractCall,
  ]);

  const handleAddClaims = useCallback(async () => {
    if (!staker.trim() || !signerManager.trim()) {
      setError("Staker and signer-manager are required.");
      return;
    }
    if (feeMicro === null || feeMicro <= 0n) {
      setError("Enter a valid fee in STX (up to 6 decimal places).");
      return;
    }

    const ok = await submitContractCall({
      functionName: "add-claims",
      functionArgs: [
        Cl.principal(staker.trim()),
        Cl.principal(signerManager.trim()),
        Cl.uint(feeMicro),
      ],
      postConditions: [
        Pc.principal(stxAddress ?? staker.trim())
          .willSendLte(feeMicro)
          .ustx(),
      ],
      failed: "Add claims failed",
    });
    if (ok) {
      setFeeStx("");
      setClaimCount("");
      await loadRegistration();
    }
  }, [
    feeMicro,
    loadRegistration,
    signerManager,
    staker,
    stxAddress,
    submitContractCall,
  ]);

  const handleCancel = useCallback(async () => {
    if (!connectedIsStaker) {
      setError("Only the staker can cancel, using that account's wallet.");
      return;
    }
    if (!staker.trim() || !signerManager.trim() || !registration) {
      setError("Load a registration before canceling.");
      return;
    }

    const refund = registration.prepaidUstx;
    const postConditions =
      refund > 0n
        ? [
            Pc.principal(config.claimsContract)
              .willSendLte(refund)
              .ustx(),
          ]
        : [];

    const ok = await submitContractCall({
      functionName: "cancel-registration",
      functionArgs: [
        Cl.principal(staker.trim()),
        Cl.principal(signerManager.trim()),
      ],
      postConditions,
      failed: "Cancel failed",
    });
    if (ok) {
      setConfirmingCancel(false);
      clearRegistration();
      setRegistrationNote(
        refund > 0n
          ? `Registration canceled. ${formatStxFromMicro(refund)} STX is refunded to the staker.`
          : "Registration canceled. There was no prepaid STX to refund.",
      );
    }
  }, [
    clearRegistration,
    config.claimsContract,
    connectedIsStaker,
    registration,
    signerManager,
    staker,
    submitContractCall,
  ]);

  return (
    <div className="claims-card">
      <div className="space-y-5">
        <label className="claims-field">
          <FieldLabel help="The Stacks account whose active pox-5 staking position will receive automated reward claims. You can enter any account here without connecting its wallet.">
            Staker
          </FieldLabel>
          <input
            className="claims-input font-mono"
            value={staker}
            onChange={(e) => {
              setStaker(e.target.value);
              setPositionNote("");
              setPositionFound(false);
              clearRegistration();
            }}
            placeholder="ST… / SP…"
            autoComplete="off"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="claims-btn-secondary"
            onClick={() => void loadDefaults()}
            disabled={loadingDefaults || loadingRegistration}
          >
            {loadingDefaults ? "Loading…" : "Load staking details"}
          </button>
          <button
            type="button"
            className="claims-btn-secondary"
            onClick={() => void loadRegistration()}
            disabled={loadingDefaults || loadingRegistration}
          >
            {loadingRegistration ? "Loading…" : "Load registration"}
          </button>
          <span className="claims-hint">
            Reads use the entered addresses; no wallet connection required.
          </span>
        </div>

        {positionNote && (
          <p
            className={
              positionFound ? "claims-note claims-note-ok" : "claims-note"
            }
          >
            {positionNote}
          </p>
        )}

        <label className="claims-field">
          <FieldLabel help="The principal managing the signer for this staking position. It must match pox-5; loading staking details fills it from the chain. Load registration uses this together with the staker.">
            Signer manager
          </FieldLabel>
          <input
            className="claims-input font-mono"
            value={signerManager}
            onChange={(e) => {
              setSignerManager(e.target.value);
              clearRegistration();
            }}
            placeholder="ST….signer-manager"
            autoComplete="off"
          />
        </label>

        {registrationNote && (
          <p className="claims-note claims-note-ok">{registrationNote}</p>
        )}

        {registered && registration && (
          <dl className="claims-summary">
            <SummaryItem
              label="Remaining claims"
              help="How many claim attempts are still prepaid."
            >
              {registration.remainingClaims.toString()}
            </SummaryItem>
            <SummaryItem
              label="Remaining escrow"
              help="STX still held by the registry for unconsumed claims. This is the amount refunded to the staker if they cancel."
            >
              {formatStxFromMicro(registration.prepaidUstx)} STX
            </SummaryItem>
            <SummaryItem
              label="Cadence"
              help="How often this registration is claimed in each pox-5 reward cycle."
            >
              {registration.oneClaimPerCycle
                ? "Once per reward cycle"
                : "Twice per reward cycle"}
            </SummaryItem>
            <SummaryItem
              label="Next distribution height"
              help="The Bitcoin block height where spox will attempt to claim pox-5 rewards for this registration."
            >
              {registration.nextClaimBurnHeight !== null
                ? `~${registration.nextClaimBurnHeight.toString()}`
                : `distribution ${registration.nextClaimDistribution.toString()}`}
            </SummaryItem>
            <SummaryItem
              label="Bond index"
              help="pox-5 bond membership for this position. None means an STX-only stake."
            >
              {registration.bondIndex === null
                ? "None (STX-only)"
                : registration.bondIndex.toString()}
            </SummaryItem>
          </dl>
        )}

        {!registered && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <label className="claims-field">
              <FieldLabel help="The first pox-5 reward cycle covered by this registration. Defaults to the staker's first eligible reward cycle.">
                Start reward cycle
              </FieldLabel>
              <input
                className="claims-input font-mono"
                value={startCycle}
                onChange={(e) => setStartCycle(e.target.value)}
                placeholder="e.g. 120"
                inputMode="numeric"
              />
            </label>

            <div className="claims-field">
              <FieldLabel help="Defaults from the staker's pox-5 position: bonded positions (some bond index) use twice per cycle; STX-only stakes (no bond index) use once. You can override either way.">
                Claim cadence
              </FieldLabel>
              <div className="claims-cadence">
                <button
                  type="button"
                  className={`claims-pill ${oneClaimPerCycle ? "claims-pill-active" : ""}`}
                  onClick={() => setOneClaimPerCycle(true)}
                >
                  Once per cycle
                </button>
                <button
                  type="button"
                  className={`claims-pill ${!oneClaimPerCycle ? "claims-pill-active" : ""}`}
                  onClick={() => setOneClaimPerCycle(false)}
                >
                  Twice per cycle
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="claims-field">
          <FieldLabel
            help={
              registered
                ? "Prepay for additional claim installments."
                : "Prepay for claim installments."
            }
          >
            Prepaid claims
          </FieldLabel>
          {loadingFeeRate && (
            <p className="claims-field-hint">Loading fee rate…</p>
          )}
          {!loadingFeeRate && feePerClaim !== null && (
            <p className="claims-field-hint">
              On-chain rate: {formatStxFromMicro(feePerClaim)} STX per claim.
            </p>
          )}
          {!loadingFeeRate &&
            feePerClaim === null &&
            !config.claimsContract && (
              <p className="claims-field-hint">
                Set the registry contract to fetch the on-chain fee rate.
              </p>
            )}

          <div
            className={`grid gap-4 mt-2 ${feePerClaim !== null ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}
          >
            {feePerClaim !== null && (
              <label className="claims-field">
                <span className="claims-field-sublabel">Number of claims</span>
                <input
                  className="claims-input font-mono"
                  value={claimCount}
                  onChange={(e) => syncFeeFromClaimCount(e.target.value)}
                  placeholder="12"
                  inputMode="numeric"
                />
              </label>
            )}
            <label className="claims-field">
              <span className="claims-field-sublabel">Escrow (STX)</span>
              <input
                className="claims-input font-mono"
                value={feeStx}
                onChange={(e) => handleFeeStxChange(e.target.value)}
                placeholder={
                  feePerClaim !== null
                    ? formatStxFromMicro(feePerClaim)
                    : "0.1"
                }
                inputMode="decimal"
              />
            </label>
          </div>
          <span className="claims-field-hint">
            Escrows whole installments only
            {cyclesBought !== null
              ? ` — ${registered ? "adds" : "buys"} ${cyclesBought.toString()} claim${cyclesBought === 1n ? "" : "s"} (max ${MAX_CLAIM_INSTALLMENTS} per call)`
              : ""}
            .
          </span>
        </div>

        {error && <div className="claims-error">{error}</div>}
        {txId && (
          <div className="claims-success">
            Transaction submitted.{" "}
            <a
              href={stacksExplorerTxUrlForConfig(txId, config)}
              target="_blank"
              rel="noopener noreferrer"
              className="claims-link"
            >
              View on explorer
            </a>
            <code className="block mt-2 text-xs break-all font-mono opacity-80">
              {txId}
            </code>
          </div>
        )}

        {registered ? (
          confirmingCancel ? (
            <div className="claims-cancel-confirm">
              <p>
                Cancel this registration?{" "}
                {registration.prepaidUstx > 0n
                  ? `${formatStxFromMicro(registration.prepaidUstx)} STX will be refunded to the staker.`
                  : "There is no prepaid STX to refund."}{" "}
                Pending sBTC withdrawals are not affected.
              </p>
              {!connectedIsStaker && (
                <p>
                  Connect the staker wallet to cancel. Admins cannot cancel for
                  them.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="claims-btn-secondary"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={submitting}
                >
                  Go back
                </button>
                <button
                  type="button"
                  className="claims-btn-danger"
                  onClick={() => void handleCancel()}
                  disabled={submitting || !connectedIsStaker}
                >
                  {submitting ? "Confirm in wallet…" : "Confirm cancel"}
                </button>
              </div>
            </div>
          ) : (
            <div className="claims-manage-actions">
              <div className="claims-manage-action claims-manage-action-primary">
                <button
                  type="button"
                  className="claims-btn-primary"
                  onClick={() => void handleAddClaims()}
                  disabled={submitting}
                >
                  {!connected
                    ? "Connect wallet to add claims"
                    : submitting
                      ? "Confirm in wallet…"
                      : "Add claims"}
                </button>
                <HelpTooltip help="Escrows STX from your wallet to buy more prepaid claim attempts. The claim schedule remains the same." />
              </div>
              <div className="claims-manage-action">
                <button
                  type="button"
                  className="claims-btn-danger-ghost"
                  onClick={() => {
                    setError("");
                    setConfirmingCancel(true);
                  }}
                  disabled={submitting}
                >
                  Cancel registration
                </button>
                <HelpTooltip help="Removes the registration and refunds the remaining escrowed STX to the staker." />
              </div>
            </div>
          )
        ) : (
          <button
            type="button"
            className="claims-btn-primary"
            onClick={() => void handleRegister()}
            disabled={submitting}
          >
            {!connected
              ? "Connect wallet to register"
              : submitting
                ? "Confirm in wallet…"
                : "Register for claims"}
          </button>
        )}
      </div>
    </div>
  );
}
