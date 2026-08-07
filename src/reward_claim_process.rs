//! Tip-driven process that advances reward claims and settlements.
//!
//! On each new Bitcoin chain tip the process:
//! 1. Fetches pending claims and broadcasts `process-reward-claims` batches,
//! 2. Fetches pending settlements and broadcasts `settle-pending-withdrawals`
//!    batches.
//!
//! Run this as its own task alongside the deposit runloop (see `main`).

use futures::StreamExt;
use tokio::sync::mpsc::Receiver;
use tokio_stream::wrappers::BroadcastStream;

use crate::bitcoin::BlockRef;
use crate::context::Context;
use crate::error::Error;

/// The capacity of the channel for sending new Bitcoin chain tips to the
/// reward claim process.
const CHANNEL_CAPACITY: usize = 1024;


/// Runs the claim → settlement pipeline for each new Bitcoin tip.
#[derive(Debug, Clone, Copy, Default)]
pub struct RewardClaimProcess;

impl RewardClaimProcess {
    /// Spawn a process that processes pending claims and settlements
    /// whenever a new Bitcoin chain tip is detected.
    ///
    /// # Notes
    /// 
    /// This function creates a new channel to send Bitcoin blocks to the
    /// reward claim process. This is done so that the Braodcast channel is
    /// not blocked by how long it takes to process claims.
    pub async fn run(self, mut block_ref_stream: BroadcastStream<BlockRef>, context: Context) {
        let (sender, rx) = tokio::sync::mpsc::channel::<BlockRef>(CHANNEL_CAPACITY);

        tokio::spawn(process_reward_claims(rx, context));

        loop {
            let chain_tip = match block_ref_stream.next().await {
                Some(Ok(chain_tip)) => chain_tip,
                Some(Err(error)) => {
                    tracing::warn!(%error, "error waiting for a new bitcoin chain tip");
                    continue;
                }
                _ => continue,
            };

            if let Err(error) = sender.try_send(chain_tip) {
                tracing::warn!(%error, "error sending new bitcoin chain tip to reward claim process");
            }
        }
    }
}

/// The loop for processing reward claims that runs whenever a new Bitcoin
/// block is detected.
async fn process_reward_claims(mut rx: Receiver<BlockRef>, context: Context) -> Result<(), Error> {
    while let Some(chain_tip) = rx.recv().await {
        if let Err(error) = process_pending_claims(&context, &chain_tip).await {
            tracing::warn!(%error, "error processing reward claims and settlements");
        }

        if let Err(error) = process_pending_settlements(&context, &chain_tip).await {
            tracing::warn!(%error, "error processing reward claims and settlements");
        }
    }

    Ok(())
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
async fn process_pending_claims(_: &Context, chain_tip: &BlockRef) -> Result<(), Error> {
    // TODO(#41/#42): fetch pending claims and submit process-reward-claims.
    tracing::trace!(%chain_tip, "reward claim processing not yet implemented");
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
    tracing::trace!(%chain_tip, "reward settlement processing not yet implemented");
    Ok(())
}
