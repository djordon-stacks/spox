import { describe, expect, it, vi, afterEach } from "vitest";
import { Cl, cvToHex } from "@stacks/transactions";
import {
  decodeContractLogHex,
  eventMatchesFilter,
  eventMatchesPrincipal,
  fetchRegistryContractEvents,
  parseRegistryContractEvent,
} from "../src/lib/registry-events";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decodeContractLogHex", () => {
  it("unwraps a print tuple into plain fields", () => {
    const hex = cvToHex(
      Cl.tuple({
        topic: Cl.stringAscii("process-reward-claim"),
        staker: Cl.principal("ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039"),
        earned: Cl.uint(0),
        "claim-error": Cl.some(Cl.uint(1)),
      }),
    );
    const decoded = decodeContractLogHex(hex);
    expect(decoded.topic).toBe("process-reward-claim");
    expect(decoded.staker).toBe(
      "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039",
    );
    expect(decoded.earned).toBe("0");
  });
});

describe("parseRegistryContractEvent", () => {
  it("parses a smart_contract_log and collects principals", () => {
    const hex = cvToHex(
      Cl.tuple({
        topic: Cl.stringAscii("register-for-claims"),
        staker: Cl.principal("ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039"),
        "signer-manager": Cl.principal(
          "ST24VB7FBXCBV6P0SRDSPSW0Y2J9XHDXNHW9Q8S7H.signer-manager",
        ),
      }),
    );
    const event = parseRegistryContractEvent({
      event_index: 0,
      event_type: "smart_contract_log",
      tx_id: "0xabc",
      contract_log: {
        contract_id: "ST2.reward-claim-registry",
        topic: "print",
        value: { hex, repr: "(tuple)" },
      },
    });
    expect(event?.topic).toBe("register-for-claims");
    expect(event?.staker).toBe(
      "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039",
    );
    expect(event?.signerManager).toBe(
      "ST24VB7FBXCBV6P0SRDSPSW0Y2J9XHDXNHW9Q8S7H.signer-manager",
    );
    expect(eventMatchesPrincipal(event!, "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039")).toBe(
      true,
    );
    expect(
      eventMatchesFilter(
        event!,
        "ST24VB7FBXCBV6P0SRDSPSW0Y2J9XHDXNHW9Q8S7H.signer-manager",
      ),
    ).toBe(true);
    expect(
      eventMatchesFilter(event!, "ST24VB7FBXCBV6P0SRDSPSW0Y2J9XHDXNHW9Q8S7H"),
    ).toBe(true);
    expect(eventMatchesFilter(event!, "register-for-claims")).toBe(true);
    expect(eventMatchesFilter(event!, "process-reward-claim")).toBe(false);
    expect(eventMatchesPrincipal(event!, "ST000000000000000000002AMW42H")).toBe(
      false,
    );
  });
});

describe("fetchRegistryContractEvents", () => {
  it("maps API results through the parser", async () => {
    const hex = cvToHex(
      Cl.tuple({
        topic: Cl.stringAscii("add-claims"),
        staker: Cl.principal("ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039"),
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          limit: 20,
          offset: 0,
          results: [
            {
              event_index: 0,
              event_type: "smart_contract_log",
              tx_id: "0xdeadbeef",
              contract_log: {
                contract_id:
                  "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
                topic: "print",
                value: { hex },
              },
            },
          ],
        }),
      ),
    );

    const page = await fetchRegistryContractEvents({
      apiUrl: "http://localhost:3999",
      claimsContract:
        "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
    });

    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.topic).toBe("add-claims");
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/extended/v1/contract/",
    );
  });
});
