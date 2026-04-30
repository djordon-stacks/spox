//! Contains client wrappers for bitcoin core

use std::sync::Arc;

use bitcoin::ScriptBuf;
use bitcoincore_rpc::jsonrpc::serde_json;
use bitcoincore_rpc::{Auth, RpcApi};
use bitcoincore_rpc_json::{
    GetChainTipsResultStatus, GetDescriptorInfoResult, ImportDescriptors, ImportMultiResult,
    ListUnspentResultEntry, LoadWalletResult, ScanTxOutRequest, Utxo as RpcUtxo,
};
use url::Url;

use crate::bitcoin::{BlockRef, Utxo};
use crate::error::Error;

impl From<RpcUtxo> for Utxo {
    fn from(value: RpcUtxo) -> Self {
        Utxo {
            txid: value.txid,
            vout: value.vout,
            script_pub_key: value.script_pub_key,
            amount: value.amount,
            block_height: value.height,
        }
    }
}

/// Models the result of "listdescriptors"
#[derive(Clone, Debug, serde::Deserialize)]
pub struct ListDescriptorsResult {
    /// List of descriptors in the wallet
    pub descriptors: Vec<ListDescriptorsInner>,
}

/// Models a descriptor entry in "listdescriptors" return value
#[derive(Clone, Debug, serde::Deserialize)]
pub struct ListDescriptorsInner {
    /// Descriptor string representation
    pub desc: String,
}

/// A client for interacting with bitcoin-core
#[derive(Clone)]
pub struct BitcoinCoreClient {
    /// The underlying bitcoin-core client
    inner: Arc<bitcoincore_rpc::Client>,
}

impl BitcoinCoreClient {
    /// Return a bitcoin-core RPC client from a auth-embedded URL and optional wallet name
    pub fn from_config(url: &Url, wallet: Option<&str>) -> Result<Self, Error> {
        let username = url.username().to_string();
        let password = url.password().unwrap_or_default().to_string();
        let host = url
            .host_str()
            .ok_or(Error::InvalidUrl(url::ParseError::EmptyHost))?;
        let port = url.port().ok_or(Error::PortRequired)?;

        let wallet_suffix = match wallet {
            Some(name) => format!("/wallet/{name}"),
            None => "".to_owned(),
        };
        let endpoint = format!("{}://{host}:{port}{wallet_suffix}", url.scheme());

        Self::new(&endpoint, username, password)
    }

    /// Return a bitcoin-core RPC client. Will error if the URL is an invalid URL.
    pub fn new(url: &str, username: String, password: String) -> Result<Self, Error> {
        let auth = Auth::UserPass(username, password);
        let client = bitcoincore_rpc::Client::new(url, auth)
            .map_err(|err| Error::BitcoinCoreRpcClient(err, url.to_string()))?;

        Ok(Self { inner: Arc::new(client) })
    }

    /// Get the canonical chain tip
    pub fn get_chain_tip(&self) -> Result<BlockRef, Error> {
        let result = self
            .inner
            .get_chain_tips()
            .map_err(Error::BitcoinCoreRpc)?
            .into_iter()
            .find(|tip| tip.status == GetChainTipsResultStatus::Active)
            .ok_or(Error::NoChainTip)?;

        Ok(BlockRef {
            block_hash: result.hash,
            block_height: result.height,
        })
    }

    /// Get UTXOs for addresses via scantxoutset
    pub fn scan_tx_out_set<'a, I>(&self, addresses: I) -> Result<Vec<Utxo>, Error>
    where
        I: IntoIterator<Item = &'a ScriptBuf>,
    {
        let descriptors = addresses
            .into_iter()
            .map(|addr| ScanTxOutRequest::Single(format!("raw({})", addr.to_hex_string())))
            .collect::<Vec<_>>();

        let result = self
            .inner
            .scan_tx_out_set_blocking(&descriptors)
            .map_err(Error::BitcoinCoreRpc)?;

        if result.success != Some(true) {
            return Err(Error::ScanTxOutFailure);
        }

        Ok(result.unspents.into_iter().map(Into::into).collect())
    }

    /// Get the canonical block hash for a given block height
    pub fn get_block_hash(&self, block_height: u64) -> Result<bitcoin::BlockHash, Error> {
        self.inner
            .get_block_hash(block_height)
            .map_err(Error::BitcoinCoreRpc)
    }

    /// Get the transaction hex
    pub fn get_raw_transaction_hex(
        &self,
        txid: &bitcoin::Txid,
        block_hash: &bitcoin::BlockHash,
    ) -> Result<String, Error> {
        self.inner
            .get_raw_transaction_hex(txid, Some(block_hash))
            .map_err(Error::BitcoinCoreRpc)
    }

    /// Load wallet
    pub fn load_wallet(&self, wallet: &str) -> Result<LoadWalletResult, Error> {
        self.inner
            .load_wallet(wallet)
            .map_err(Error::BitcoinCoreRpc)
    }

    /// Create a wallet
    pub fn create_wallet(&self, wallet: &str) -> Result<LoadWalletResult, Error> {
        // We cannot use `create_wallet` because it's an old version missing some arguments
        let args = [
            wallet.to_owned().into(),
            true.into(),          // disable_private_keys
            true.into(),          // blank
            "".to_owned().into(), // passphrase
            false.into(),         // avoid_reuse
            true.into(),          // descriptors
            true.into(),          // load_on_startup
        ];

        self.inner
            .call("createwallet", &args)
            .map_err(Error::BitcoinCoreRpc)
    }

    /// List wallet descriptors for the wallet specified on client creation
    pub fn list_descriptors(&self) -> Result<ListDescriptorsResult, Error> {
        self.inner
            .call("listdescriptors", &[])
            .map_err(Error::BitcoinCoreRpc)
    }

    /// Import descriptors in the client wallet
    pub fn import_descriptors(
        &self,
        descriptors: &[ImportDescriptors],
    ) -> Result<Vec<ImportMultiResult>, Error> {
        // We cannot use `import_descriptors` because it accepts a single descriptor
        let descriptors = descriptors
            .iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| Error::BitcoinCoreRpc(e.into()))?
            .into();

        self.inner
            .call("importdescriptors", &[descriptors])
            .map_err(Error::BitcoinCoreRpc)
    }

    /// Get a descriptor info
    pub fn get_descriptor_info(&self, desc: &str) -> Result<GetDescriptorInfoResult, Error> {
        self.inner
            .get_descriptor_info(desc)
            .map_err(Error::BitcoinCoreRpc)
    }

    /// List unspent outputs tracked by the client wallet
    pub fn list_unspent(&self) -> Result<Vec<ListUnspentResultEntry>, Error> {
        // We don't expected the watched UTXO set to grow so much that returning
        // all the UTXOs here is going to be an issue. If it does, consider
        // switching to filtering the UTXO by passing `addresses`. Note that we
        // need to specify P2TR addresses, since `listunspent` requires proper
        // addresses and not just raw scripts descriptors.
        self.inner
            .list_unspent(Some(1), None, None, None, None)
            .map_err(Error::BitcoinCoreRpc)
    }
}
