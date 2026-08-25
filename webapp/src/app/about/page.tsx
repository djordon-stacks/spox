"use client";

import { ClaimsShell } from "@/components/claims/claims-shell";

export default function AboutPage() {
  return (
    <ClaimsShell
      active="about"
      lede="If you stake STX under pox-5, rewards no longer arrive on their own — spox submits the claim transactions for you."
    >
      <article className="claims-card claims-about">
        <section>
          <h2>About spox</h2>
          <p>
            Before the pox-5 hard fork, PoX rewards appeared automatically as BTC
            in a staker's Bitcoin address. Not anymore. pox-5 pays rewards as{" "}
            <strong>sBTC</strong> held in the pox-5 smart contract, and moving
            that sBTC to you — as sBTC on Stacks or as BTC on Bitcoin — requires
            a specific sequence of contract calls.
          </p>
          <p>
            spox runs that schedule so you don't have to. It
            has two pieces:
          </p>
          <ul>
            <li>
              an on-chain registry contract,
              where stakers can opt-in and prepay STX for a fixed number of
              prepaid claim attempts, and
            </li>
            <li>
              an off-chain application that reads pending work from the
              registry and submits the claim transactions when rewards are
              ready.
            </li>
          </ul>
          <p>
            Anyone can run spox — the design is permissionless — and the
            registry never custodies sBTC or your staked STX.
          </p>
        </section>

        <section>
          <h2>Your signer-manager</h2>
          <p>
            Your signer-manager is the smart contract tied to
            your pox-5 stake. The pox-5 smart contract sends your rewards to
            the signer-manager, and it is designed to pay these rewards to the
            Stacks or Bitcoin address you configured.
          </p>
        </section>

        <section>
          <h2>What this site does</h2>
          <p>
            This is a web UI for the reward-claim-registry contract. From here
            you can:
          </p>
          <ul>
            <li>
              <strong>Look up a staker</strong> and see the signer-manager
              running their pox-5 position, plus any existing registration.
            </li>
            <li>
              <strong>Register</strong>, choose whether to claim once or twice
              per reward cycle, and prepay STX that buys a fixed number of
              prepaid claim attempts.
            </li>
            <li>
              <strong>Top up</strong> an active registration with more
              attempts, or <strong>cancel</strong> and refund any unused prepaid
              STX.
            </li>
            <li>
              <strong>Browse events</strong> the contract has emitted —
              registrations, claims, withdrawals, cancellations.
            </li>
          </ul>
          <p>
            Registration requires an active pox-5 stake under the
            signer-manager you specify. You choose the cadence and the starting
            reward cycle during registration. A single call can buy up to 192
            attempts.
          </p>
        </section>

        <section>
          <h2>How automated claims run</h2>
          <p>Once you are registered, the spox application does the work:</p>
          <ol>
            <li>
              Each new Bitcoin block, it checks the registry for stakers who are
              due a claim.
            </li>
            <li>
              When you're due, it submits a transaction that claims your
              rewards via your signer-manager to your configured payout
              address.
            </li>
            <li>
              If that payout address is on Bitcoin, the withdrawal is tracked
              separately and settled on-chain once the sBTC signers accept or
              reject it.
            </li>
          </ol>
          <p>
            Each reward cycle has two
            distribution periods; a claim can be submitted only after a distribution
            period ends and pox-5 has finished calculating rewards for that
            period. Each attempt uses one prepaid claim attempt.
          </p>

          <h3>On-chain details</h3>
          <ul>
            <li>
              Pending work is processed via{" "}
              <code>reward-claim-registry::process-reward-claims</code>. That
              call pulls the staker's pox-5 rewards into the signer-manager
              when needed, then claims the staker's share.
            </li>
            <li>
              Claims wait until <code>pox-5::calculate-rewards</code> has
              covered the target distribution.
            </li>
          </ul>
        </section>

        <section>
          <h2>Fees</h2>
          <p>
            Each prepaid claim attempt escrows 0.01 STX into the registry.
            That STX is burned when the attempt runs;
            cancellation refunds whatever is left. spox takes no cut — the fee
            is burned so each prepaid claim has a real cost, which discourages
            spam and abuse of the registry
          </p>
        </section>

        <section>
          <h2>What spox isn't</h2>
          <p>
            spox does not stake STX for you, hold staked STX, or hold sBTC
            rewards. Your funds remain in pox-5 and your signer-manager
            throughout. The registry holds only the STX you prepaid for future
            claim attempts.
          </p>
        </section>

        <section>
          <h2>Further reading</h2>
          <ul>
            <li>
              <a
                href="https://docs.stacks.co/pox-5/development/rewards"
                target="_blank"
                rel="noopener noreferrer"
                className="claims-lede-link"
              >
                pox-5 rewards
              </a>
            </li>
            <li>
              <a
                href="https://github.com/stx-labs/spox"
                target="_blank"
                rel="noopener noreferrer"
                className="claims-lede-link"
              >
                spox on GitHub
              </a>
            </li>
            <li>
              <a
                href="https://github.com/stacks-network/stacks-core/blob/4.0.2/contrib/core-contract-tests/contracts/signer-manager.clar"
                target="_blank"
                rel="noopener noreferrer"
                className="claims-lede-link"
              >
                reference signer-manager in stacks-core
              </a>
            </li>
          </ul>
        </section>
      </article>
    </ClaimsShell>
  );
}
