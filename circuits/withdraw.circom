pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

// A note is defined by two private random field elements: (nullifier, secret).
//   commitment   = Poseidon(nullifier, secret)   -> stored as a leaf on deposit
//   nullifierHash = Poseidon(nullifier)           -> revealed on withdraw
// Revealing nullifierHash lets the contract reject a second withdrawal of the
// same note WITHOUT revealing which deposit it was.
template CommitmentHasher() {
    signal input nullifier;
    signal input secret;
    signal output commitment;
    signal output nullifierHash;

    component cHash = Poseidon(2);
    cHash.inputs[0] <== nullifier;
    cHash.inputs[1] <== secret;
    commitment <== cHash.out;

    component nHash = Poseidon(1);
    nHash.inputs[0] <== nullifier;
    nullifierHash <== nHash.out;
}

// Veil withdrawal circuit (Privacy-Pools style).
//
// In zero knowledge the prover demonstrates, all at once, that:
//   (1) they know the opening of a commitment,
//   (2) that commitment is a leaf of the full deposits tree   (root),
//   (3) that SAME commitment is also a leaf of the approved
//       association tree (associationRoot), i.e. it belongs to the
//       compliant subset, which is what makes the privacy auditable,
//   (4) the revealed nullifierHash matches the note (anti double-spend).
//
// The payout addresses and the fee are folded in so the proof is worthless to
// anyone who wants to redirect it. A Stellar address does not fit in one field
// element: it is a 32-byte payload plus a type discriminant, so it is carried
// as two limbs, `Hi` = the type byte and the first 16 payload bytes, `Lo` = the
// remaining 16. The contract re-derives both from the address it is about to
// pay and compares them (see contracts/veil/src/address_bind.rs), which is what
// makes the commitment binding rather than decorative.
template Withdraw(levels) {
    // ---- public inputs ----
    signal input root;             // Merkle root of ALL deposits
    signal input associationRoot;  // Merkle root of APPROVED (compliant) subset
    signal input nullifierHash;    // revealed; contract stores it to block reuse
    signal input recipientHi;      // recipient address, high limb (type + 16 bytes)
    signal input recipientLo;      // recipient address, low limb (16 bytes)
    signal input relayerHi;        // relayer address, high limb
    signal input relayerLo;        // relayer address, low limb
    signal input fee;              // amount paid to the relayer out of the note

    // ---- private inputs ----
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input assocPathElements[levels];
    signal input assocPathIndices[levels];

    // Recompute commitment + nullifierHash and bind the public nullifierHash.
    component hasher = CommitmentHasher();
    hasher.nullifier <== nullifier;
    hasher.secret <== secret;
    hasher.nullifierHash === nullifierHash;

    // (2) membership in the full deposits tree
    component tree = MerkleProof(levels);
    tree.leaf <== hasher.commitment;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;

    // (3) membership in the approved association tree (compliance)
    component atree = MerkleProof(levels);
    atree.leaf <== hasher.commitment;
    for (var i = 0; i < levels; i++) {
        atree.pathElements[i] <== assocPathElements[i];
        atree.pathIndices[i] <== assocPathIndices[i];
    }
    atree.root === associationRoot;

    // Bind the payout addresses and the fee into the constraint system
    // (Tornado-style): squaring each one forces it to appear in a real
    // constraint, so it cannot be varied after the fact without invalidating
    // the proof. Without this the signals would be optimised away and the
    // proof would say nothing about who gets paid.
    signal recipientHiSq;
    recipientHiSq <== recipientHi * recipientHi;
    signal recipientLoSq;
    recipientLoSq <== recipientLo * recipientLo;
    signal relayerHiSq;
    relayerHiSq <== relayerHi * relayerHi;
    signal relayerLoSq;
    relayerLoSq <== relayerLo * relayerLo;
    signal feeSq;
    feeSq <== fee * fee;
}

component main {public [
    root,
    associationRoot,
    nullifierHash,
    recipientHi,
    recipientLo,
    relayerHi,
    relayerLo,
    fee
]} = Withdraw(20);
