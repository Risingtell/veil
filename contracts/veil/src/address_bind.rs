//! Binding a Stellar address into circuit public inputs, exactly.
//!
//! The withdrawal circuit commits to who gets paid, but the contract has to
//! check that commitment against the address it is actually paying, or the
//! commitment is decorative. It previously did not: `withdraw` took a
//! `recipient: Address` and paid it without ever comparing it to the proof's
//! recipient input. Anyone could lift a pending withdrawal's proof and public
//! inputs verbatim, resubmit them naming their own address, and be paid. The
//! proof still verified, because none of its inputs had changed.
//!
//! Closing that means the payout address must be *derivable* from the public
//! inputs and compared byte for byte.
//!
//! # Encoding
//!
//! A Soroban address carries a 32-byte payload plus a discriminant: an Ed25519
//! public key for an account (`G...`), or a hash for a contract (`C...`). All
//! 33 bytes matter, and 33 bytes do not fit in one 254-bit field element, so
//! the address is split across two:
//!
//! ```text
//!   buf = [kind_byte] ++ payload[0..32]      (33 bytes)
//!   hi  = big-endian buf[0..17]              (136 bits)
//!   lo  = big-endian buf[17..33]             (128 bits)
//! ```
//!
//! Both limbs sit far below the modulus, so neither can be re-encoded
//! non-canonically, and the map is injective: equal limbs mean an equal
//! discriminant and an equal payload. No hashing is involved, so there is no
//! collision assumption to reason about. The check is a byte comparison.

use soroban_sdk::{address_payload::AddressPayload, Address, BytesN, Env};

use crate::field::from_be_slice;

/// Discriminant for an account address (`G...`).
const KIND_ACCOUNT: u8 = 0;
/// Discriminant for a contract address (`C...`).
const KIND_CONTRACT: u8 = 1;

/// Split `address` into the two field elements the circuit commits to.
///
/// Returns `None` for an address whose type this SDK version does not
/// recognise, which callers must treat as a rejection rather than a default,
/// silently binding an unknown address type would reopen the hole this closes.
pub fn to_limbs(env: &Env, address: &Address) -> Option<(BytesN<32>, BytesN<32>)> {
    let (kind, payload) = match address.to_payload()? {
        AddressPayload::AccountIdPublicKeyEd25519(key) => (KIND_ACCOUNT, key),
        AddressPayload::ContractIdHash(hash) => (KIND_CONTRACT, hash),
    };

    let mut buf = [0u8; 33];
    buf[0] = kind;
    buf[1..33].copy_from_slice(&payload.to_array());

    Some((from_be_slice(env, &buf[0..17]), from_be_slice(env, &buf[17..33])))
}

/// Whether `address` is exactly the address committed to by `(hi, lo)`.
pub fn matches(env: &Env, address: &Address, hi: &BytesN<32>, lo: &BytesN<32>) -> bool {
    match to_limbs(env, address) {
        Some((h, l)) => &h == hi && &l == lo,
        None => false,
    }
}
