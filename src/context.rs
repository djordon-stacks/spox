//! Application context

use std::sync::Arc;

use emily_client::apis::configuration::Configuration as EmilyConfig;

use crate::bitcoin::node::BitcoinCoreClient;
use crate::config::Settings;
use crate::error::Error;
use crate::stacks::node::StacksClient;
use crate::stacks::registry::DepositAddressRegistry;
use crate::stacks::wallet::StacksWallet;
use crate::storage::memory::{SharedStore, Store};

/// Application context
#[derive(Clone)]
pub struct Context {
    bitcoin_client: BitcoinCoreClient,
    emily_config: Arc<EmilyConfig>,
    storage: SharedStore,
    settings: Arc<Settings>,
    registry: Option<Arc<DepositAddressRegistry>>,
    #[allow(dead_code)]
    wallet: Option<Arc<StacksWallet>>,
}

impl Context {
    /// Build a context from settings.
    ///
    /// When [`Settings::reward_claims_enabled`] is true, `[stacks]` and
    /// `private_key` are required, and this queries `GET /v2/info` so the
    /// signing wallet can be constructed with the node's chain id.
    /// Nonce starts at `0`; submit paths must refresh it via `get_account` +
    /// [`StacksWallet::set_nonce`] before signing.
    pub async fn try_new(value: &Settings) -> Result<Self, Error> {
        let bitcoin_client = BitcoinCoreClient::from_config(
            &value.bitcoin_rpc_endpoint,
            value.node_wallet.as_ref().map(|w| w.name.as_str()),
            value.bitcoin_rpc_timeout,
        )?;
        let emily_config = EmilyConfig {
            base_path: value
                .emily_endpoint
                .to_string()
                .trim_end_matches('/')
                .to_string(),
            ..Default::default()
        };
        let registry = value
            .registry_contract
            .clone()
            .map(|registry_contract| {
                StacksClient::try_from(value)
                    .map(|client| Arc::new(DepositAddressRegistry::new(registry_contract, client)))
            })
            .transpose()?;

        let wallet = if value.reward_claims_enabled {
            // Nonce is left at 0 on purpose. Callers that submit transactions must
            // set_nonce from get_account first.
            match value.stacks.as_ref() {
                Some(stacks) => {
                    let client = StacksClient::new(stacks.rpc_endpoint.clone())?;
                    let info = client.get_node_info().await?;
                    let wallet = StacksWallet::new(stacks.private_key, info.chain_id, 0);
                    Some(Arc::new(wallet))
                }
                None => return Err(Error::MissingStacksConfig),
            }
        } else {
            None
        };

        Ok(Self {
            bitcoin_client,
            emily_config: Arc::new(emily_config),
            storage: Store::new_shared(),
            settings: Arc::new(value.clone()),
            registry,
            wallet,
        })
    }

    /// Get a reference to the Bitcoin client
    pub fn bitcoin_client(&self) -> &BitcoinCoreClient {
        &self.bitcoin_client
    }

    /// Get a reference to the Emily config
    pub fn emily_config(&self) -> &EmilyConfig {
        &self.emily_config
    }

    /// Get a reference to the storage
    pub fn storage(&self) -> SharedStore {
        self.storage.clone()
    }

    /// Get a reference to the config
    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    /// Get a reference to the registry
    pub fn registry(&self) -> Option<&DepositAddressRegistry> {
        self.registry.as_deref()
    }
}
