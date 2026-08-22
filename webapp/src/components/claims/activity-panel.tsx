"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useClaimsConfig } from "@/components/claims/claims-config-provider";
import {
  eventMatchesFilter,
  fetchRegistryContractEvents,
  type RegistryContractEvent,
} from "@/lib/registry-events";
import { stacksExplorerTxUrlForConfig } from "@/lib/claims-config";

const PAGE_SIZE = 20;

function formatPayloadValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function EventCard({
  event,
  explorerUrl,
}: {
  event: RegistryContractEvent;
  explorerUrl: string;
}) {
  const highlightKeys = [
    "staker",
    "signer-manager",
    "reward-cycle",
    "claim-distribution",
    "earned",
    "claim-error",
    "withdrawal-request",
    "num-claims",
    "escrowed",
  ];
  const rows = highlightKeys
    .filter((key) => key in event.payload && key !== "topic")
    .map((key) => ({
      key,
      value: formatPayloadValue(event.payload[key]),
    }));

  return (
    <article className="claims-event-card">
      <header className="claims-event-card-head">
        <h3 className="claims-event-topic">
          {event.topic ?? "print"}
        </h3>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="claims-link font-mono text-xs"
        >
          {event.txId.slice(0, 10)}…{event.txId.slice(-6)}
        </a>
      </header>
      {rows.length > 0 ? (
        <dl className="claims-event-fields">
          {rows.map((row) => (
            <div key={row.key}>
              <dt>{row.key}</dt>
              <dd className="font-mono">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="claims-field-hint">
          {event.repr ?? "No decoded fields for this event."}
        </p>
      )}
    </article>
  );
}

export function ActivityPanel() {
  const { config, ready } = useClaimsConfig();
  const [events, setEvents] = useState<RegistryContractEvent[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [principalFilter, setPrincipalFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadPage = useCallback(
    async (nextOffset: number, replace: boolean) => {
      if (!config.claimsContract) {
        setError("Claims registry contract is not configured for this network.");
        setEvents([]);
        setHasMore(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const page = await fetchRegistryContractEvents(config, {
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setEvents((prev) =>
          replace ? page.events : [...prev, ...page.events],
        );
        setOffset(nextOffset + page.events.length);
        setHasMore(page.events.length >= PAGE_SIZE);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        if (replace) setEvents([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [config],
  );

  useEffect(() => {
    if (!ready) return;
    setAppliedFilter("");
    setPrincipalFilter("");
    setEvents([]);
    setOffset(0);
    void loadPage(0, true);
    // Reload when the effective network / API / contract changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadPage closes over config
  }, [ready, config.apiUrl, config.claimsContract, config.network]);

  const visible = useMemo(
    () =>
      events.filter((event) => eventMatchesFilter(event, appliedFilter)),
    [appliedFilter, events],
  );

  return (
    <div className="claims-card space-y-5">
      <div className="space-y-2">
        <p className="claims-field-hint">
          Latest <code>print</code> events from the reward-claim registry,
          newest first. Paste a staker, signer-manager, or topic to filter
          the events already loaded.
        </p>
        {!config.claimsContract && (
          <p className="claims-note">
            No registry contract configured for {config.network}. Set the
            per-network build variable or enter one in developer mode.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="claims-field flex-1 min-w-[14rem]">
          <span className="claims-field-sublabel">Filter</span>
          <input
            className="claims-input font-mono"
            value={principalFilter}
            onChange={(e) => setPrincipalFilter(e.target.value)}
            placeholder="ST… / SP….signer-manager / process-reward-claim"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="claims-btn-secondary"
          onClick={() => setAppliedFilter(principalFilter.trim())}
          disabled={loading}
        >
          Apply filter
        </button>
        <button
          type="button"
          className="claims-btn-ghost"
          onClick={() => {
            setPrincipalFilter("");
            setAppliedFilter("");
          }}
          disabled={loading || (!principalFilter && !appliedFilter)}
        >
          Clear
        </button>
        <button
          type="button"
          className="claims-btn-ghost"
          onClick={() => void loadPage(0, true)}
          disabled={loading || !config.claimsContract}
        >
          Refresh
        </button>
      </div>

      {appliedFilter && (
        <p className="claims-field-hint">
          Showing events matching{" "}
          <code className="font-mono">{appliedFilter}</code> among{" "}
          {events.length} loaded event{events.length === 1 ? "" : "s"}
          {visible.length !== events.length
            ? ` (${visible.length} match${visible.length === 1 ? "" : "es"})`
            : ""}
          . Load more if the match is older than this window.
        </p>
      )}

      {error && <div className="claims-error">{error}</div>}

      {loading && events.length === 0 && (
        <p className="claims-field-hint">Loading events…</p>
      )}

      {!loading && !error && events.length === 0 && config.claimsContract && (
        <p className="claims-field-hint">No events returned for this contract.</p>
      )}

      <div className="space-y-3">
        {visible.map((event) => (
          <EventCard
            key={`${event.txId}:${event.eventIndex}`}
            event={event}
            explorerUrl={stacksExplorerTxUrlForConfig(event.txId, config)}
          />
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          className="claims-btn-secondary"
          onClick={() => void loadPage(offset, false)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
