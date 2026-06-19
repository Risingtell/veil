#![no_std]
//! # Veil — a compliant privacy pool for USDC on Stellar.
//!
//! This single contract bundles two things:
//!
//! 1. A **BN254 Groth16 verifier** built on the Protocol 26 host functions
//!    (`env.crypto().bn254().pairing_check`). This is what makes the ZK
//!    *load-bearing*: nothing pays out unless a valid proof verifies here.
//!
//! 2. A **privacy pool** with a compliance (Association Set Provider) gate.
//!    Users deposit a fixed denomination of USDC against a commitment, and
//!    later withdraw to a fresh address by submitting a proof that — in zero
//!    knowledge — shows their note is (a) a real deposit, (b) in the approved
//!    association set, and (c) not already spent (nullifier).
//!
//! The proof is produced off-chain with Circom/snarkjs (`circuits/withdraw.circom`).
//! The verification key and proof are passed in as raw big-endian bytes
//! (EIP-197 / Ethereum-compatible encoding) and reconstructed into BN254 curve
//! points inside the contract.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    token, vec, Address, Bytes, BytesN, Env, U256, Vec,
};

/// Verification key, EIP-197 byte encoding. `ic` has (#public_inputs + 1) points.
#[contracttype]
#[derive(Clone)]
pub struct VkBytes {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

/// A Groth16 proof, EIP-197 byte encoding.
#[contracttype]
#[derive(Clone)]
pub struct ProofBytes {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    UnknownRoot = 3,
    NullifierAlreadyUsed = 4,
    BadAssociationRoot = 5,
    InvalidProof = 6,
    BadPublicInputs = 7,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Denom,
    Vk,
    Auditor,               // BytesN<32>: packed BabyJubJub public key of the regulator
    AssocRoot,
    Roots,                 // Vec<BytesN<32>>: registered deposit-tree roots
    Commitments,           // Vec<BytesN<32>>: every deposited commitment (auditability)
    Audits,                // Vec<Bytes>: encrypted audit record per deposit (parallel to Commitments)
    Nullifier(BytesN<32>), // spent markers
}

#[contract]
pub struct Veil;

#[contractimpl]
impl Veil {
    /// One-time initialization. `denom` is the fixed note size (in token
    /// stroops). `auditor` is the packed BabyJubJub public key of the regulator
    /// permitted to open audit records. `vk` is the Groth16 verification key.
    pub fn init(
        env: Env,
        admin: Address,
        token: Address,
        denom: i128,
        auditor: BytesN<32>,
        vk: VkBytes,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Denom, &denom);
        env.storage().instance().set(&DataKey::Auditor, &auditor);
        env.storage().instance().set(&DataKey::Vk, &vk);
        env.storage().persistent().set(&DataKey::Roots, &Vec::<BytesN<32>>::new(&env));
        env.storage().persistent().set(&DataKey::Commitments, &Vec::<BytesN<32>>::new(&env));
        env.storage().persistent().set(&DataKey::Audits, &Vec::<Bytes>::new(&env));
    }

    /// Deposit `denom` of the pool token against `commitment`
    /// (= Poseidon(nullifier, secret), computed client-side).
    ///
    /// `audit` is an encrypted audit record (Poseidon-ElGamal over BabyJubJub)
    /// that only the auditor's view-key can open. It is published on-chain so
    /// the regulator's ability to de-anonymize never depends on the depositor
    /// retaining off-chain data — privacy to the public, auditability by design.
    pub fn deposit(env: Env, from: Address, commitment: BytesN<32>, audit: Bytes) {
        from.require_auth();
        let denom: i128 = get(&env, &DataKey::Denom);
        let token_addr: Address = get(&env, &DataKey::Token);
        token::TokenClient::new(&env, &token_addr).transfer(
            &from,
            &env.current_contract_address(),
            &denom,
        );
        let mut commits: Vec<BytesN<32>> =
            env.storage().persistent().get(&DataKey::Commitments).unwrap();
        commits.push_back(commitment.clone());
        env.storage().persistent().set(&DataKey::Commitments, &commits);
        let mut audits: Vec<Bytes> =
            env.storage().persistent().get(&DataKey::Audits).unwrap();
        audits.push_back(audit);
        env.storage().persistent().set(&DataKey::Audits, &audits);
        env.events().publish((soroban_sdk::symbol_short!("deposit"),), commitment);
    }

    /// Operator registers a new deposit-tree root (computed off-chain over the
    /// recorded commitments with the same Poseidon used in-circuit).
    pub fn publish_root(env: Env, root: BytesN<32>) {
        admin(&env).require_auth();
        let mut roots: Vec<BytesN<32>> =
            env.storage().persistent().get(&DataKey::Roots).unwrap();
        roots.push_back(root);
        env.storage().persistent().set(&DataKey::Roots, &roots);
    }

    /// ASP publishes the current approved-association-set root.
    pub fn set_association_root(env: Env, root: BytesN<32>) {
        admin(&env).require_auth();
        env.storage().instance().set(&DataKey::AssocRoot, &root);
    }

    /// Withdraw `denom` to `recipient` against a valid ZK proof.
    ///
    /// `public_inputs` order matches the circuit:
    ///   [root, associationRoot, nullifierHash, recipient, fee]
    pub fn withdraw(
        env: Env,
        proof: ProofBytes,
        public_inputs: Vec<BytesN<32>>,
        recipient: Address,
    ) -> Result<(), Error> {
        if public_inputs.len() != 5 {
            return Err(Error::BadPublicInputs);
        }
        let root = public_inputs.get(0).unwrap();
        let assoc = public_inputs.get(1).unwrap();
        let nullifier = public_inputs.get(2).unwrap();

        // (a) the deposit root must be one we registered
        let roots: Vec<BytesN<32>> =
            env.storage().persistent().get(&DataKey::Roots).unwrap();
        if !roots.iter().any(|r| r == root) {
            return Err(Error::UnknownRoot);
        }
        // (b) the association root must match the ASP's current root
        let asp: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::AssocRoot)
            .ok_or(Error::BadAssociationRoot)?;
        if asp != assoc {
            return Err(Error::BadAssociationRoot);
        }
        // (c) nullifier must be unspent
        if env.storage().persistent().has(&DataKey::Nullifier(nullifier.clone())) {
            return Err(Error::NullifierAlreadyUsed);
        }
        // (d) the proof itself
        let vk: VkBytes = get(&env, &DataKey::Vk);
        if !groth16_verify(&env, &vk, &proof, &public_inputs) {
            return Err(Error::InvalidProof);
        }

        // commit: mark spent and pay out
        env.storage()
            .persistent()
            .set(&DataKey::Nullifier(nullifier.clone()), &true);
        let denom: i128 = get(&env, &DataKey::Denom);
        let token_addr: Address = get(&env, &DataKey::Token);
        token::TokenClient::new(&env, &token_addr).transfer(
            &env.current_contract_address(),
            &recipient,
            &denom,
        );
        env.events()
            .publish((soroban_sdk::symbol_short!("withdraw"),), nullifier);
        Ok(())
    }

    /// Stateless verifier exposed for tests / external use: verify a proof
    /// against the stored verification key. Returns true iff valid.
    pub fn verify_proof(env: Env, proof: ProofBytes, public_inputs: Vec<BytesN<32>>) -> bool {
        let vk: VkBytes = get(&env, &DataKey::Vk);
        groth16_verify(&env, &vk, &proof, &public_inputs)
    }

    /// The regulator's view-key (packed BabyJubJub public key) declared at init.
    pub fn auditor(env: Env) -> BytesN<32> {
        get(&env, &DataKey::Auditor)
    }

    /// All on-chain encrypted audit records, in deposit order (parallel to the
    /// commitments). Public, but only openable with the auditor's private key.
    pub fn audit_records(env: Env) -> Vec<Bytes> {
        env.storage().persistent().get(&DataKey::Audits).unwrap()
    }

    /// Every deposited commitment, in order (for auditor enumeration).
    pub fn commitments(env: Env) -> Vec<BytesN<32>> {
        env.storage().persistent().get(&DataKey::Commitments).unwrap()
    }
}

// ---- internal helpers ----

fn admin(env: &Env) -> Address {
    get(env, &DataKey::Admin)
}

fn get<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val> + soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &DataKey,
) -> T {
    env.storage()
        .instance()
        .get(key)
        .or_else(|| env.storage().persistent().get(key))
        .unwrap_or_else(|| panic_with(env, Error::NotInitialized))
}

fn panic_with(env: &Env, e: Error) -> ! {
    panic_with_error!(env, e)
}
use soroban_sdk::panic_with_error;

fn g1(env: &Env, b: &BytesN<64>) -> Bn254G1Affine {
    Bn254G1Affine::from_array(env, &b.to_array())
}
fn g2(env: &Env, b: &BytesN<128>) -> Bn254G2Affine {
    Bn254G2Affine::from_array(env, &b.to_array())
}
fn fr(env: &Env, b: &BytesN<32>) -> Bn254Fr {
    let bytes = Bytes::from_array(env, &b.to_array());
    let u = U256::from_be_bytes(env, &bytes);
    u.into()
}

/// Groth16 verification on BN254 using the Protocol 26 pairing host function.
///
/// Checks  e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1,
/// where   vk_x = IC₀ + Σ publicᵢ · ICᵢ₊₁.
fn groth16_verify(env: &Env, vk: &VkBytes, proof: &ProofBytes, pubs: &Vec<BytesN<32>>) -> bool {
    // ic must have exactly one more element than there are public inputs.
    if vk.ic.len() != pubs.len() + 1 {
        return false;
    }
    let bn = env.crypto().bn254();

    // vk_x = IC[0] + Σ pub[i] * IC[i+1]
    let mut vk_x = g1(env, &vk.ic.get(0).unwrap());
    for i in 0..pubs.len() {
        let ic = g1(env, &vk.ic.get(i + 1).unwrap());
        let s = fr(env, &pubs.get(i).unwrap());
        let term = bn.g1_mul(&ic, &s);
        vk_x = bn.g1_add(&vk_x, &term);
    }

    let neg_a = -g1(env, &proof.a); // Neg on G1
    let g1s: Vec<Bn254G1Affine> = vec![
        env,
        neg_a,
        g1(env, &vk.alpha),
        vk_x,
        g1(env, &proof.c),
    ];
    let g2s: Vec<Bn254G2Affine> = vec![
        env,
        g2(env, &proof.b),
        g2(env, &vk.beta),
        g2(env, &vk.gamma),
        g2(env, &vk.delta),
    ];
    bn.pairing_check(g1s, g2s)
}

#[cfg(test)]
mod test;
