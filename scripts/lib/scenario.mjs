// The pool scenario shared by the prove/verify scripts and the demo, so all of
// them exercise one code path rather than three drifting copies.
//
// Five notes are deposited. A compliance reviewer approves four of them; the
// fifth is flagged and stays in the pool but provably cannot be withdrawn.

import { createHash } from "node:crypto";

import {
  LEVELS,
  MerkleTree,
  encodeStrkey,
  makeHasher,
  makeNote,
} from "./veil.mjs";

/// Deterministic demo addresses, derived so they are real checksum-valid
/// strkeys rather than placeholder text.
export function demoAddress(label, kind = 0) {
  return encodeStrkey(createHash("sha256").update(label).digest(), kind);
}

// Contract-type addresses (C...). A Stellar Asset Contract will only pay a
// classic account that already holds a trustline for the asset, which the
// contract's own test ledger has no way to set up; contract addresses need no
// trustline, so using them here keeps the end-to-end test self-contained.
// The live testnet demo pays a real funded G... account over native XLM, and
// `address_limbs_match_prover` pins the encoding for both address kinds.
export const RECIPIENT = demoAddress("veil:demo:recipient", 1);
export const RELAYER = demoAddress("veil:demo:relayer", 1);

/// Build the pool: `count` deposits, of which `approvedIndices` are compliant.
export async function buildPool({ count = 5, approvedIndices = [0, 1, 2, 3] } = {}) {
  const { hash1, hash2 } = await makeHasher();
  const deposits = new MerkleTree(LEVELS, hash2);
  const approved = new MerkleTree(LEVELS, hash2);

  const notes = Array.from({ length: count }, () => makeNote(hash1, hash2));
  for (const n of notes) deposits.insert(n.commitment);
  for (const i of approvedIndices) approved.insert(notes[i].commitment);

  return { hash1, hash2, notes, deposits, approved, approvedIndices };
}
