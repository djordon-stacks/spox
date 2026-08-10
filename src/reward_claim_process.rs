//! Tip-driven process that advances reward claims and settlements.
//!
//! On each new Bitcoin chain tip the process:
//! 1. Fetches pending claims and broadcasts `process-reward-claims` batches,
//! 2. Fetches pending settlements and broadcasts `settle-pending-withdrawals`
//!    batches.
//!
//! Run via [`crate::dispatch::run_on_chain_tips`] alongside deposit
//! monitoring (see `main`).

use std::sync::Arc;

use tokio::sync::mpsc;

use crate::bitcoin::BlockRef;
use crate::context::Context;
use crate::error::Error;
use crate::stacks::node::{StacksClient, SubmitTxResponse};
use crate::stacks::reward_claim_registry::RewardClaimRegistry;
use crate::stacks::transaction::AsContractCall as _;

/// The transaction fee for all contract call transactions against the
/// registry.
const TX_FEE: u64 = 100000;

/// The loop for processing reward claims that runs whenever a new Bitcoin
/// block is detected.
pub async fn process_reward_claims(mut rx: mpsc::Receiver<BlockRef>, context: Context) {
    if context.settings().reward_claims.is_none() {
        tracing::info!("reward claims are not configured, skipping");
        return;
    }

    while let Some(chain_tip) = rx.recv().await {
        if let Err(error) = process_pending_claims(&context, &chain_tip).await {
            tracing::warn!(%error, "error processing pending reward claims");
        }

        if let Err(error) = process_pending_settlements(&context, &chain_tip).await {
            tracing::warn!(%error, "error processing pending settlements");
        }
    }
}

/// The function that processes pending claims.
///
/// # Notes
///
/// This function works as follows:
/// 1. Gets all pending claims from the registry.
/// 2. Submits a process-reward-claims contract call for each batch of
///    claims, where a batch is a group of at most 100 stakers who are
///    associated with the same signer-manager.
async fn process_pending_claims(context: &Context, chain_tip: &BlockRef) -> Result<(), Error> {
    let settings = context.settings();
    let Some(registry_config) = settings.reward_claims.as_ref() else {
        tracing::info!("reward claims are not configured, skipping");
        return Ok(());
    };

    let client = Arc::new(StacksClient::try_from(settings)?);

    let registry =
        RewardClaimRegistry::new(registry_config.claims_contract.clone(), client.clone());
    let batches = registry.get_pending_claim_batches().await?;

    let wallet = context.wallet().await?;
    let account = client.get_account(wallet.address()).await?;
    wallet.set_nonce(account.nonce);

    for batch in batches {
        let payload = batch.tx_payload();
        let tx = wallet.sign_tx(payload, TX_FEE);

        match client.submit_tx(&tx).await {
            Ok(SubmitTxResponse::Acceptance(txid)) => {
                tracing::debug!(%txid, "submitted process-reward-claims batch")
            }
            Ok(SubmitTxResponse::Rejection(error)) => {
                tracing::warn!(%error, "failed to submit process-reward-claims batch")
            }
            Err(error) => tracing::warn!(%error, "failed to submit process-reward-claims batch"),
        };
    }

    tracing::debug!(%chain_tip, "submitted process-reward-claims batches");
    Ok(())
}

/// The function that processes pending settlements.
///
/// # Notes
///
/// This function works as follows:
/// 1. Gets all pending settlements from the registry.
/// 2. Submits a settle-pending-withdrawals contract call for each batch of
///    settlements, where a batch is a group of at most 100 stakers who are
///    associated with the same signer-manager.
async fn process_pending_settlements(_: &Context, chain_tip: &BlockRef) -> Result<(), Error> {
    // TODO(#40/#42): fetch pending settlements and submit settle-pending-withdrawals.
    tracing::debug!(%chain_tip, "reward settlement processing not yet implemented");
    Ok(())
}
