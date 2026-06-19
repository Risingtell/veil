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
//       association tree (associationRoot) — i.e. it belongs to the
//       compliant subset, which is what makes the privacy auditable,
//   (4) the revealed nullifierHash matches the note (anti double-spend).
// `recipient` and `fee` are folded in to bind the proof to a specific
// payout and defeat front-running / proof malleability.
template Withdraw(levels) {
    // ---- public inputs ----
    signal input root;             // Merkle root of ALL deposits
    signal input associationRoot;  // Merkle root of APPROVED (compliant) subset
    signal input nullifierHash;    // revealed; contract stores it to block reuse
    signal input recipient;        // payout address (field-encoded)
    signal input fee;              // relayer fee (field-encoded)

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

    // Bind recipient & fee into the constraint system (Tornado-style)
    // so a relayer cannot tamper with the destination or fee.
    signal recipientSq;
    recipientSq <== recipient * recipient;
    signal feeSq;
    feeSq <== fee * fee;
}

component main {public [root, associationRoot, nullifierHash, recipient, fee]} = Withdraw(20);
