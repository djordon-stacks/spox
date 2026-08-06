//! Client for the on-chain reward claim registry.

use clarity::types::chainstate::StacksAddress;
use clarity::vm::ClarityName;
use clarity::vm::ContractName;
use clarity::vm::Value as ClarityValue;
use clarity::vm::types::ListData;
use clarity::vm::types::PrincipalData;
use clarity::vm::types::QualifiedContractIdentifier;
use clarity::vm::types::SequenceData;
use clarity::vm::types::TupleData;

use crate::error::Error;
use crate::stacks::clarity::ClarityTuple;
use crate::stacks::node::StacksClient;

/// Key identifying a registration in the reward claim registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegistrationKey {
    /// The staker principal on the registration.
    pub staker: PrincipalData,
    /// The signer-manager principal on the registration.
    pub signer_manager: PrincipalData,
}

/// A single pending claim row from `get-pending-claims`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingClaim {
    /// The signer-manager principal for this registration.
    pub signer_manager: PrincipalData,
    /// The staker principal for this registration.
    pub staker: PrincipalData,
    /// Bond index when the staker is in a bond; `None` for STX-only stakes.
    pub bond_index: Option<u128>,
    /// The pox-5 reward cycle to claim.
    pub reward_cycle: u128,
}

impl PendingClaim {
    /// Registration key for this claim row (used as a pagination cursor).
    pub fn registration_key(&self) -> RegistrationKey {
        RegistrationKey {
            staker: self.staker.clone(),
            signer_manager: self.signer_manager.clone(),
        }
    }
}

/// Client for querying the on-chain reward claim registry contract.
#[derive(Debug, Clone)]
pub struct RewardClaimRegistry {
    /// The deployer of the registry smart contract.
    contract_principal: StacksAddress,
    /// The name of the registry smart contract.
    contract_name: ContractName,
    /// The client used to make the requests.
    client: StacksClient,
}

impl RewardClaimRegistry {
    /// Create a new reward claim registry client.
    pub fn new(contract: QualifiedContractIdentifier, client: StacksClient) -> Self {
        let contract_principal = contract.issuer.into();

        Self {
            contract_name: contract.name,
            contract_principal,
            client,
        }
    }

    /// Fetch a page of pending claims from the registry.
    ///
    /// Pass `None` for `cursor` to start at the head of the registration
    /// linked list. To paginate, pass the last row's `RegistrationKey` from
    /// the previous page so the walk resumes at that key's successor.
    ///
    /// An empty page does not by itself mean the linked list is exhausted:
    /// non-pending registrations still consume walk ticks. Callers that need
    /// every pending claim should keep resuming from the last returned key
    /// (see [`Self::get_all_pending_claims`]).
    pub async fn get_pending_claims(
        &self,
        cursor: Option<&RegistrationKey>,
    ) -> Result<Vec<PendingClaim>, Error> {
        let cursor_arg = match cursor {
            Some(key) => {
                let tuple = TupleData::from_data(vec![
                    (
                        ClarityName::from("staker"),
                        ClarityValue::Principal(key.staker.clone()),
                    ),
                    (
                        ClarityName::from("signer-manager"),
                        ClarityValue::Principal(key.signer_manager.clone()),
                    ),
                ])
                .map_err(|_| Error::InvalidStacksResponse("could not construct cursor tuple"))?;
                ClarityValue::some(ClarityValue::Tuple(tuple)).map_err(|_| {
                    Error::InvalidStacksResponse("could not construct cursor option")
                })?
            }
            None => ClarityValue::none(),
        };

        let result = self
            .client
            .call_read(
                &self.contract_principal,
                &self.contract_name,
                &ClarityName::from("get-pending-claims"),
                &self.contract_principal,
                &[cursor_arg],
            )
            .await?;

        let ClarityValue::Response(response) = result else {
            return Err(Error::InvalidStacksResponse("expected a response"));
        };

        let ClarityValue::Sequence(SequenceData::List(ListData { data, .. })) = *response.data
        else {
            return Err(Error::InvalidStacksResponse("did not get a list"));
        };

        data.into_iter().map(PendingClaim::try_from).collect()
    }

    /// Fetch every pending claim by paging through `get-pending-claims`.
    ///
    /// Starts at the head and keeps calling with the last returned row's
    /// registration key until a page comes back empty after that key has been
    /// sent as the cursor (or the first page is empty).
    pub async fn get_all_pending_claims(&self) -> Result<Vec<PendingClaim>, Error> {
        let mut all = Vec::new();
        let mut cursor: Option<RegistrationKey> = None;

        loop {
            let page = self.get_pending_claims(cursor.as_ref()).await?;
            let Some(last) = page.last() else {
                break;
            };
            cursor = Some(last.registration_key());
            all.extend(page);
        }

        Ok(all)
    }
}

impl TryFrom<ClarityValue> for PendingClaim {
    type Error = Error;

    fn try_from(value: ClarityValue) -> Result<Self, Self::Error> {
        let mut clarity_map = ClarityTuple::try_from(value)?;

        let bond_index = clarity_map
            .remove_option("bond-index")?
            .map(|value| match value {
                ClarityValue::UInt(index) => Ok(index),
                _ => Err(Error::InvalidStacksResponse("bond-index was not a uint")),
            })
            .transpose()?;

        Ok(PendingClaim {
            signer_manager: clarity_map.remove_principal("signer-manager")?,
            staker: clarity_map.remove_principal("staker")?,
            bond_index,
            reward_cycle: clarity_map.remove_uint("reward-cycle")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use bitcoincore_rpc::jsonrpc::serde_json;
    use clarity::vm::types::OptionalData;

    use super::*;

    impl From<&PendingClaim> for ClarityValue {
        fn from(value: &PendingClaim) -> Self {
            let bond_index = value
                .bond_index
                .map(|index| Box::new(ClarityValue::UInt(index as u128)));
            let tuple_entries = vec![
                (
                    ClarityName::from("signer-manager"),
                    ClarityValue::Principal(value.signer_manager.clone()),
                ),
                (
                    ClarityName::from("staker"),
                    ClarityValue::Principal(value.staker.clone()),
                ),
                (
                    ClarityName::from("bond-index"),
                    ClarityValue::Optional(OptionalData { data: bond_index }),
                ),
                (
                    ClarityName::from("reward-cycle"),
                    ClarityValue::UInt(value.reward_cycle as u128),
                ),
            ];
            ClarityValue::Tuple(TupleData::from_data(tuple_entries).unwrap())
        }
    }

    impl From<&RegistrationKey> for ClarityValue {
        fn from(value: &RegistrationKey) -> Self {
            let tuple_entries = vec![
                (
                    ClarityName::from("staker"),
                    ClarityValue::Principal(value.staker.clone()),
                ),
                (
                    ClarityName::from("signer-manager"),
                    ClarityValue::Principal(value.signer_manager.clone()),
                ),
            ];
            ClarityValue::Tuple(TupleData::from_data(tuple_entries).unwrap())
        }
    }

    fn ok_list(claims: &[PendingClaim]) -> ClarityValue {
        let rows: Vec<ClarityValue> = claims.iter().map(ClarityValue::from).collect();
        ClarityValue::okay(ClarityValue::cons_list_unsanitized(rows).unwrap()).unwrap()
    }

    #[tokio::test]
    async fn get_pending_claims_works_without_cursor() {
        let staker = PrincipalData::parse("ST2FQWJMF9CGPW34ZWK8FEPNK072NEV1VKRNBBMJ9").unwrap();
        let signer_manager =
            PrincipalData::parse("ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.signer-manager")
                .unwrap();

        let claim = PendingClaim {
            signer_manager: signer_manager.clone(),
            staker: staker.clone(),
            bond_index: None,
            reward_cycle: 42,
        };

        let raw_json_response = format!(
            r#"{{"okay": true, "result":"0x{}"}}"#,
            ok_list(&[claim.clone()]).serialize_to_hex().unwrap(),
        );

        let mut stacks_node_server = mockito::Server::new_async().await;
        let mock = stacks_node_server
            .mock(
                "POST",
                "/v2/contracts/call-read/ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039/reward-claim-registry/get-pending-claims?tip=latest",
            )
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "arguments": [ClarityValue::none().serialize_to_hex().unwrap()]
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(&raw_json_response)
            .expect(1)
            .create();

        let client_url = url::Url::parse(stacks_node_server.url().as_str()).unwrap();
        let client = StacksClient::new(client_url).unwrap();

        let registry = RewardClaimRegistry::new(
            QualifiedContractIdentifier::parse(
                "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
            )
            .unwrap(),
            client,
        );

        let result = registry.get_pending_claims(None).await.unwrap();

        assert_eq!(result, vec![claim]);
        mock.assert();
    }

    #[tokio::test]
    async fn get_pending_claims_works_with_cursor() {
        let staker = PrincipalData::parse("ST2FQWJMF9CGPW34ZWK8FEPNK072NEV1VKRNBBMJ9").unwrap();
        let signer_manager =
            PrincipalData::parse("ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.signer-manager")
                .unwrap();

        let cursor = RegistrationKey {
            staker: staker.clone(),
            signer_manager: signer_manager.clone(),
        };

        let claim = PendingClaim {
            signer_manager,
            staker: PrincipalData::parse("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM").unwrap(),
            bond_index: Some(7),
            reward_cycle: 99,
        };

        let cursor_hex = ClarityValue::some(ClarityValue::from(&cursor))
            .unwrap()
            .serialize_to_hex()
            .unwrap();

        let raw_json_response = format!(
            r#"{{"okay": true, "result":"0x{}"}}"#,
            ok_list(&[claim.clone()]).serialize_to_hex().unwrap(),
        );

        let mut stacks_node_server = mockito::Server::new_async().await;
        let mock = stacks_node_server
            .mock(
                "POST",
                "/v2/contracts/call-read/ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039/reward-claim-registry/get-pending-claims?tip=latest",
            )
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "arguments": [cursor_hex]
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(&raw_json_response)
            .expect(1)
            .create();

        let client_url = url::Url::parse(stacks_node_server.url().as_str()).unwrap();
        let client = StacksClient::new(client_url).unwrap();

        let registry = RewardClaimRegistry::new(
            QualifiedContractIdentifier::parse(
                "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
            )
            .unwrap(),
            client,
        );

        let result = registry.get_pending_claims(Some(&cursor)).await.unwrap();

        assert_eq!(result, vec![claim]);
        mock.assert();
    }

    #[tokio::test]
    async fn get_pending_claims_empty_page() {
        let raw_json_response = format!(
            r#"{{"okay": true, "result":"0x{}"}}"#,
            ok_list(&[]).serialize_to_hex().unwrap(),
        );

        let mut stacks_node_server = mockito::Server::new_async().await;
        let mock = stacks_node_server
            .mock(
                "POST",
                "/v2/contracts/call-read/ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039/reward-claim-registry/get-pending-claims?tip=latest",
            )
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(&raw_json_response)
            .expect(1)
            .create();

        let client_url = url::Url::parse(stacks_node_server.url().as_str()).unwrap();
        let client = StacksClient::new(client_url).unwrap();

        let registry = RewardClaimRegistry::new(
            QualifiedContractIdentifier::parse(
                "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
            )
            .unwrap(),
            client,
        );

        let result = registry.get_pending_claims(None).await.unwrap();

        assert!(result.is_empty());
        mock.assert();
    }

    #[tokio::test]
    async fn get_all_pending_claims_pages_until_empty() {
        let signer_manager =
            PrincipalData::parse("ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.signer-manager")
                .unwrap();

        let first = PendingClaim {
            signer_manager: signer_manager.clone(),
            staker: PrincipalData::parse("ST2FQWJMF9CGPW34ZWK8FEPNK072NEV1VKRNBBMJ9").unwrap(),
            bond_index: None,
            reward_cycle: 42,
        };
        let second = PendingClaim {
            signer_manager: signer_manager.clone(),
            staker: PrincipalData::parse("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM").unwrap(),
            bond_index: Some(7),
            reward_cycle: 99,
        };

        let cursor = first.registration_key();
        let cursor_hex = ClarityValue::some(ClarityValue::from(&cursor))
            .unwrap()
            .serialize_to_hex()
            .unwrap();

        let mut stacks_node_server = mockito::Server::new_async().await;
        let path = "/v2/contracts/call-read/ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039/reward-claim-registry/get-pending-claims?tip=latest";

        let first_page = stacks_node_server
            .mock("POST", path)
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "arguments": [ClarityValue::none().serialize_to_hex().unwrap()]
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(format!(
                r#"{{"okay": true, "result":"0x{}"}}"#,
                ok_list(&[first.clone()]).serialize_to_hex().unwrap(),
            ))
            .expect(1)
            .create();

        let second_page = stacks_node_server
            .mock("POST", path)
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "arguments": [cursor_hex]
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(format!(
                r#"{{"okay": true, "result":"0x{}"}}"#,
                ok_list(&[second.clone()]).serialize_to_hex().unwrap(),
            ))
            .expect(1)
            .create();

        let second_cursor = second.registration_key();
        let second_cursor_hex = ClarityValue::some(ClarityValue::from(&second_cursor))
            .unwrap()
            .serialize_to_hex()
            .unwrap();

        let empty_page = stacks_node_server
            .mock("POST", path)
            .match_body(mockito::Matcher::PartialJson(serde_json::json!({
                "arguments": [second_cursor_hex]
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(format!(
                r#"{{"okay": true, "result":"0x{}"}}"#,
                ok_list(&[]).serialize_to_hex().unwrap(),
            ))
            .expect(1)
            .create();

        let client_url = url::Url::parse(stacks_node_server.url().as_str()).unwrap();
        let client = StacksClient::new(client_url).unwrap();

        let registry = RewardClaimRegistry::new(
            QualifiedContractIdentifier::parse(
                "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
            )
            .unwrap(),
            client,
        );

        let result = registry.get_all_pending_claims().await.unwrap();

        assert_eq!(result, vec![first, second]);
        first_page.assert();
        second_page.assert();
        empty_page.assert();
    }
}
