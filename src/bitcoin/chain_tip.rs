//! This module provides a poller for detecting new blocks on the Bitcoin
//! blockchain.
//!
//! The `BitcoinChainTipPoller` is the primary component, responsible for
//! periodically calling the `getbestblockhash` RPC method on a Bitcoin Core
//! node. When it detects a new block hash, it broadcasts it to all subscribers.
//!
//! This approach provides a resilient, event-driven stream of new block hashes
//! that other components, like the `BlockObserver`, can consume. The poller is
//! designed to be robust, handling transient RPC errors by logging and retrying,
//! ensuring continuous operation as long as the Bitcoin node is reachable.
//!
//! The poller is created using the `BitcoinChainTipPollerBuilder`, which
//! provides a fluent interface for configuration.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::bitcoin::BlockRef;
use crate::bitcoin::node::BitcoinCoreClient;
use crate::error::Error;

/// The default capacity of the broadcast channel for sending new block hashes.
const DEFAULT_BROADCAST_CAPACITY: usize = 1000;

/// A trait for calling the `getchaintip` RPC method on a Bitcoin Core node.
pub trait BitcoinChainTipCaller: Send + Sync {
    /// Get the current Bitcoin chain tip.
    fn get_chain_tip(&self) -> Result<BlockRef, Error>;
}

impl BitcoinChainTipCaller for BitcoinCoreClient {
    fn get_chain_tip(&self) -> Result<BlockRef, Error> {
        self.get_chain_tip()
    }
}

/// A poller that periodically checks for and broadcasts new Bitcoin chain tips.
///
/// This struct manages a background task that polls a Bitcoin Core node's RPC
/// to get the latest block hash. It provides a stream of these hashes that other
/// parts of the application can subscribe to.
#[derive(Clone)]
pub struct BitcoinChainTipPoller {
    /// The sender for the broadcast channel that distributes new block hashes.
    sender: broadcast::Sender<BlockRef>,
    /// A handle to the background polling task, used for graceful shutdown.
    poller_task_handle: Arc<JoinHandle<()>>,
}

/// Runs the RPC polling loop in a background task.
///
/// This function polls the `getbestblockhash` RPC method at a regular interval,
/// detects new block hashes, and broadcasts them on the provided channel.
async fn run_poller<B>(rpc: B, sender: broadcast::Sender<BlockRef>, polling_interval: Duration)
where
    B: BitcoinChainTipCaller,
{
    let mut last_seen_chain_tip: Option<BlockRef> = None;

    loop {
        match rpc.get_chain_tip() {
            Ok(current_hash) => {
                if Some(&current_hash) != last_seen_chain_tip.as_ref() {
                    tracing::trace!(new_hash = %current_hash, "detected new best block hash");

                    match sender.send(current_hash) {
                        Ok(_) => last_seen_chain_tip = Some(current_hash),
                        Err(broadcast::error::SendError(_)) => {
                            tracing::warn!("no active subscribers for block hash broadcast");
                        }
                    }
                }
            }
            Err(error) => {
                // On a transient error, log it and continue polling. Do not send the
                // error to consumers, as they cannot act on it.
                tracing::warn!(%error, "failed to get best block hash during polling; will retry.");
            }
        }

        tokio::time::sleep(polling_interval).await;
    }
}

impl BitcoinChainTipPoller {
    /// Creates and starts a new `BitcoinChainTipPoller` task.
    ///
    /// This private method is called by the builder. It polls the bitcoin node.
    pub async fn start<B>(rpc: B, polling_interval: Duration) -> Self
    where
        B: BitcoinChainTipCaller + 'static,
    {
        let (sender, _) = broadcast::channel::<BlockRef>(DEFAULT_BROADCAST_CAPACITY);

        // Spawn the RPC polling task.
        let poller_task_handle = tokio::spawn(run_poller(rpc, sender.clone(), polling_interval));

        Self {
            sender,
            poller_task_handle: Arc::new(poller_task_handle),
        }
    }

    /// Stops the background polling task.
    pub fn stop(self) {
        self.poller_task_handle.abort();
    }

    /// Subscribes to the poller, returning a new stream of block hashes.
    pub fn new_receiver(&self) -> broadcast::Receiver<BlockRef> {
        self.sender.subscribe()
    }
}
