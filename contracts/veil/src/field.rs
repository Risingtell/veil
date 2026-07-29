//! Canonical BN254 scalar-field encoding.
//!
//! Field elements arrive as 32 raw bytes, but 32 bytes hold more values than
//! the field does. The host reduces anything oversized mod `p` *silently*, so
//! `n` and `n + p` are indistinguishable to the proof system while remaining
//! distinct byte strings to everything else: storage keys, equality checks,
//! event payloads.
//!
//! That gap is exploitable. The nullifier hash is what marks a note spent, and
//! it is stored under its bytes; accepting a non-canonical encoding of an
//! already-spent nullifier would let the same note be withdrawn again with the
//! same proof. About five distinct encodings of any field element fit below
//! 2^256, so the pool would pay out roughly five times per note.
//!
//! Everything crossing the contract boundary is therefore required to be
//! canonical: strictly less than `p`, rejected otherwise, before any proof is
//! checked. `rejects_non_canonical_public_input` covers this.

use soroban_sdk::{BytesN, Env, Vec};

/// The BN254 scalar field modulus, big-endian.
///
/// p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
pub const MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Whether `value` is a canonical field element, i.e. strictly below `p`.
///
/// Big-endian comparison from the most significant byte: the first differing
/// byte decides. Equality with `p` is not canonical either, since `p` encodes
/// zero.
pub fn is_canonical(value: &BytesN<32>) -> bool {
    let bytes = value.to_array();
    for i in 0..32 {
        if bytes[i] < MODULUS[i] {
            return true;
        }
        if bytes[i] > MODULUS[i] {
            return false;
        }
    }
    // Exactly equal to p.
    false
}

/// Whether every element of `values` is canonical.
pub fn all_canonical(values: &Vec<BytesN<32>>) -> bool {
    values.iter().all(|v| is_canonical(&v))
}

/// Big-endian 32-byte value from a slice of at most 32 bytes, left-padded.
pub fn from_be_slice(env: &Env, bytes: &[u8]) -> BytesN<32> {
    assert!(bytes.len() <= 32);
    let mut out = [0u8; 32];
    out[32 - bytes.len()..].copy_from_slice(bytes);
    BytesN::from_array(env, &out)
}
