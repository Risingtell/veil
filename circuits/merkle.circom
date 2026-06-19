pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Poseidon hash of two field elements — used for every internal Merkle node.
// Poseidon is deliberately chosen: it is ZK-friendly AND is a native host
// function on Stellar from Protocol 25 ("X-Ray") onward.
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;

    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    hash <== h.out;
}

// Given an ordering bit `s` (0 => current node is the left child, 1 => right),
// route the two inputs into (left, right) without leaking which is which.
template DualMux() {
    signal input in[2];
    signal input s;          // must be boolean
    signal output out[2];

    s * (1 - s) === 0;       // enforce s ∈ {0,1}
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Recompute a Merkle root from a leaf and its authentication path.
// The verifier later checks this computed root equals a public root.
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];   // each ∈ {0,1}
    signal output root;

    component selectors[levels];
    component hashers[levels];

    signal hashes[levels + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== hashes[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];

        hashes[i + 1] <== hashers[i].hash;
    }

    root <== hashes[levels];
}
