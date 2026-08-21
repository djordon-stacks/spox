# spox Reward Claims — Web App

A static Next.js app for registering a [pox-5](https://docs.stacks.co/pox-5/development/rewards) staking position with the spox reward-claim registry. The root page reads position and registration state from the Stacks API and signs `register-for-claims`, `add-claims`, and `cancel-registration` with a connected wallet.

The original sBTC deposit-address UI remains under `src/legacy` (with Bitcoin script helpers and tests), but it is not exposed by an App Router route or included in the deployed site.

## Getting Started

```bash
cd webapp
pnpm install
cp .env.example .env   # then edit with your values
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001). `/claims` serves the same interface for compatibility.

### Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_NETWORK` | Stacks network: `mainnet`, `testnet`, or `devnet`. The Bitcoin network is derived automatically (`mainnet` or `regtest`). |
| `NEXT_PUBLIC_CLAIMS_REGISTRY_CONTRACT` | Qualified contract id of the reward-claim registry (e.g. `ST1234….reward-claim-registry`). |
| `NEXT_PUBLIC_STACKS_API_URL` | Optional Stacks API base URL. Defaults to the public Stacks API for mainnet/testnet, or `http://localhost:3999` for devnet. |
| `NEXT_PUBLIC_BASE_PATH` | Optional path prefix for static hosting (e.g. `/spox` on GitHub Pages). |

**Local devnet:** point `NEXT_PUBLIC_STACKS_API_URL` at a Stacks API (e.g. `http://localhost:3999`), not a raw Stacks node RPC. Browsers cannot call node endpoints directly because of CORS.

### Using the claims page

1. **Enter a staker address** — any Stacks account; you do not need to connect its wallet to read state.
2. **Load staking details** — reads the live pox-5 position and fills signer-manager, start cycle, and claim cadence (once per cycle for STX-only stakes, twice when a bond index is present). If the registry is deployed, also fetches `get-fee-per-claim`; otherwise enter the fee manually.
3. **Load registration** — separate button; requires staker + signer-manager. Calls `get-registration` on the registry. Clears any staking-details note. If no row exists, the UI explains that registration requires a live pox-5 stake under that signer-manager.
4. **Register** — connect the staker wallet and submit `register-for-claims` with prepaid STX for the chosen number of cycles.
5. **Manage an existing registration** — summary shows remaining claims, remaining escrow, cadence, next distribution height, and bond index. **Add claims** prepays more cycles; **Cancel registration** refunds remaining escrow (staker signature required).

Read-only calls (position, fee, registration) do not require a wallet. Writes require the staker to sign; cancel is staker-only.

### Developer mode

Toggle **Developer mode** on the claims page to override network, Stacks API URL, and registry contract at runtime (stored in `localStorage`). Turn it off to revert to build-time env defaults.

Changing the network updates the chain used for wallet transactions and explorer links. It does **not** automatically change the Stacks API URL or registry contract — adjust those fields explicitly when switching networks.

## Tests

```bash
pnpm test
```

- [tests/claims-api.test.ts](tests/claims-api.test.ts) — registry read helpers and URL construction
- [tests/bitcoin.test.ts](tests/bitcoin.test.ts) — legacy Bitcoin script/derivation helpers
- [tests/deposit.test.ts](tests/deposit.test.ts) — legacy deposit input validation

## Static export & GitHub Pages

The app builds as a static site (`output: "export"` → `webapp/out`).

```bash
pnpm build
pnpm start   # serves out/ on port 3001
```

For a project GitHub Pages site, set `NEXT_PUBLIC_BASE_PATH` to the repo name (e.g. `/spox`) before building. The workflow [`.github/workflows/deploy-webapp-pages.yaml`](../.github/workflows/deploy-webapp-pages.yaml) builds and deploys `webapp/out` when triggered manually from the Actions tab (any branch).

Configure optional repository variables:

- `WEBAPP_NETWORK`
- `WEBAPP_CLAIMS_REGISTRY_CONTRACT`
- `WEBAPP_STACKS_API_URL`

Enable GitHub Pages with **Source: GitHub Actions**.
