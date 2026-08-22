import { describe, expect, it } from "vitest";
import {
  bootAddressForNetwork,
  claimsContractForNetwork,
  defaultApiUrlForNetwork,
  feeMicroForClaimCount,
  formatStxFromMicro,
  parseStxToMicro,
  pox5ContractForNetwork,
  principalMatchesNetwork,
  resolveClaimsConfig,
  stacksExplorerContractUrlForConfig,
} from "../src/lib/claims-config";

describe("formatStxFromMicro", () => {
  it("formats whole STX without decimals", () => {
    expect(formatStxFromMicro(2_000_000n)).toBe("2");
  });

  it("trims trailing zeros from fractional STX", () => {
    expect(formatStxFromMicro(250_000n)).toBe("0.25");
  });
});

describe("parseStxToMicro", () => {
  it("round-trips with formatStxFromMicro", () => {
    const micro = 1_234_567n;
    expect(parseStxToMicro(formatStxFromMicro(micro))).toBe(micro);
  });
});

describe("feeMicroForClaimCount", () => {
  it("multiplies claim count by the on-chain rate", () => {
    expect(feeMicroForClaimCount(12n, 250_000n)).toBe(3_000_000n);
  });
});

describe("defaultApiUrlForNetwork", () => {
  it("returns the known Stacks API for each network", () => {
    expect(defaultApiUrlForNetwork("mainnet")).toBe(
      "https://api.mainnet.hiro.so",
    );
    expect(defaultApiUrlForNetwork("testnet")).toBe(
      "https://api.testnet.hiro.so",
    );
    expect(defaultApiUrlForNetwork("devnet")).toBe("http://localhost:3999");
  });
});

describe("pox5ContractForNetwork", () => {
  it("uses the mainnet boot address on mainnet", () => {
    expect(pox5ContractForNetwork("mainnet")).toBe(
      "SP000000000000000000002Q6VF78.pox-5",
    );
    expect(bootAddressForNetwork("mainnet")).toBe(
      "SP000000000000000000002Q6VF78",
    );
  });

  it("uses the testnet boot address on testnet and devnet", () => {
    expect(pox5ContractForNetwork("testnet")).toBe(
      "ST000000000000000000002AMW42H.pox-5",
    );
    expect(pox5ContractForNetwork("devnet")).toBe(
      "ST000000000000000000002AMW42H.pox-5",
    );
  });
});

describe("principalMatchesNetwork", () => {
  it("treats SP/SM as mainnet and ST/SN as testnet/devnet", () => {
    expect(
      principalMatchesNetwork(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        "mainnet",
      ),
    ).toBe(true);
    expect(
      principalMatchesNetwork(
        "ST2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        "mainnet",
      ),
    ).toBe(false);
    expect(
      principalMatchesNetwork(
        "ST2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.signer-manager",
        "devnet",
      ),
    ).toBe(true);
    expect(
      principalMatchesNetwork(
        "SN3R84XZYA63QS28932XQF3G1J8R9PC3W76P9CSQS",
        "testnet",
      ),
    ).toBe(true);
    expect(principalMatchesNetwork("", "mainnet")).toBeNull();
    expect(principalMatchesNetwork("not-an-address", "mainnet")).toBeNull();
  });
});

describe("resolveClaimsConfig", () => {
  it("reads mainnet when developer mode is off, ignoring stored network overrides", () => {
    const config = resolveClaimsConfig(false, {
      network: "testnet",
      apiUrl: "https://api.testnet.hiro.so",
    });
    expect(config.network).toBe("mainnet");
    expect(config.apiUrl).toBe("https://api.mainnet.hiro.so");
    expect(config.usingOverrides).toBe(false);
  });

  it("uses the selected network's API default when no API override is set", () => {
    const config = resolveClaimsConfig(true, { network: "mainnet" });
    expect(config.network).toBe("mainnet");
    expect(config.apiUrl).toBe("https://api.mainnet.hiro.so");
  });

  it("keeps an explicit API override across network selection", () => {
    const config = resolveClaimsConfig(true, {
      network: "mainnet",
      apiUrl: "https://api.example.test",
    });
    expect(config.apiUrl).toBe("https://api.example.test");
  });

  it("uses the per-network registry contract for the selected network", () => {
    const prevMain = process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_MAINNET;
    const prevTest = process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_TESTNET;
    const prevLegacy = process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT;
    const prevNetwork = process.env.NEXT_PUBLIC_NETWORK;
    process.env.NEXT_PUBLIC_NETWORK = "devnet";
    process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_MAINNET =
      "SP1111111111111111111111111111111111111111.reward-claim-registry";
    process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_TESTNET =
      "ST2222222222222222222222222222222222222222.reward-claim-registry";
    process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT =
      "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry";
    try {
      expect(claimsContractForNetwork("mainnet")).toBe(
        "SP1111111111111111111111111111111111111111.reward-claim-registry",
      );
      expect(claimsContractForNetwork("testnet")).toBe(
        "ST2222222222222222222222222222222222222222.reward-claim-registry",
      );
      // Legacy only applies to the build network (devnet here).
      expect(claimsContractForNetwork("devnet")).toBe(
        "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
      );

      const mainnet = resolveClaimsConfig(true, { network: "mainnet" });
      expect(mainnet.claimsContract).toBe(
        "SP1111111111111111111111111111111111111111.reward-claim-registry",
      );
      const testnet = resolveClaimsConfig(true, { network: "testnet" });
      expect(testnet.claimsContract).toBe(
        "ST2222222222222222222222222222222222222222.reward-claim-registry",
      );
    } finally {
      if (prevMain === undefined) {
        delete process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_MAINNET;
      } else {
        process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_MAINNET = prevMain;
      }
      if (prevTest === undefined) {
        delete process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_TESTNET;
      } else {
        process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT_TESTNET = prevTest;
      }
      if (prevLegacy === undefined) {
        delete process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT;
      } else {
        process.env.NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT = prevLegacy;
      }
      if (prevNetwork === undefined) {
        delete process.env.NEXT_PUBLIC_NETWORK;
      } else {
        process.env.NEXT_PUBLIC_NETWORK = prevNetwork;
      }
    }
  });
});

describe("stacksExplorerContractUrlForConfig", () => {
  const contract =
    "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry";

  it("builds mainnet explorer links", () => {
    const config = resolveClaimsConfig(true, {
      network: "mainnet",
    });
    expect(stacksExplorerContractUrlForConfig(contract, config)).toBe(
      `https://explorer.hiro.so/txid/${contract}`,
    );
  });

  it("builds testnet explorer links", () => {
    const config = resolveClaimsConfig(true, {
      network: "testnet",
    });
    expect(stacksExplorerContractUrlForConfig(contract, config)).toBe(
      `https://explorer.hiro.so/txid/${contract}?chain=testnet`,
    );
  });

  it("builds devnet explorer links with the configured API", () => {
    const config = resolveClaimsConfig(true, {
      network: "devnet",
    });
    expect(stacksExplorerContractUrlForConfig(contract, config)).toBe(
      `http://localhost:3020/txid/${contract}?chain=testnet&api=http%3A%2F%2Flocalhost%3A3999&ssr=false`,
    );
  });

  it("returns null for malformed contract ids", () => {
    const config = resolveClaimsConfig(false, {});
    expect(stacksExplorerContractUrlForConfig("", config)).toBeNull();
    expect(
      stacksExplorerContractUrlForConfig("not-a-contract", config),
    ).toBeNull();
  });
});
