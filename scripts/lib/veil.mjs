// Veil shared library: Poseidon hashing, fixed-depth Merkle trees, and note
// helpers. These mirror exactly what the Circom circuit computes, so an input
// generated here will satisfy the constraints in withdraw.circom.

import { buildPoseidon } from "circomlibjs";
import { randomBytes } from "node:crypto";

export const LEVELS = 20;
// BN254 scalar field modulus — the field every signal lives in.
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Build Poseidon hashers that return plain BigInts (not field-internal repr).
export async function makeHasher() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash1 = (a) => F.toObject(poseidon([a]));
  const hash2 = (a, b) => F.toObject(poseidon([a, b]));
  return { hash1, hash2, F };
}

// A random field element, used for note secrets / nullifiers.
export function randomField() {
  // 31 bytes < field size, always reduces safely.
  return BigInt("0x" + randomBytes(31).toString("hex")) % FIELD;
}

// A Veil note. commitment is what gets deposited (a Merkle leaf);
// nullifierHash is revealed on withdrawal to prevent double-spends.
export function makeNote(hash1, hash2) {
  const nullifier = randomField();
  const secret = randomField();
  const commitment = hash2(nullifier, secret);
  const nullifierHash = hash1(nullifier);
  return { nullifier, secret, commitment, nullifierHash };
}

// Fixed-depth Merkle tree over Poseidon. Empty positions are filled with a
// deterministic "zero" subtree so paths are always full-length.
export class MerkleTree {
  constructor(levels, hash2, zeroLeaf = 0n) {
    this.levels = levels;
    this.hash2 = hash2;
    this.leaves = [];
    // zeros[i] = root of an all-empty subtree of height i
    this.zeros = [zeroLeaf];
    for (let i = 0; i < levels; i++) {
      this.zeros.push(hash2(this.zeros[i], this.zeros[i]));
    }
  }

  insert(leaf) {
    this.leaves.push(BigInt(leaf));
    return this.leaves.length - 1; // index of inserted leaf
  }

  indexOf(leaf) {
    const v = BigInt(leaf);
    return this.leaves.findIndex((x) => x === v);
  }

  // Compute the array of nodes at a given level (0 = leaves).
  _layer(level) {
    if (level === 0) return this.leaves.slice();
    const below = this._layer(level - 1);
    const out = [];
    for (let i = 0; i < below.length; i += 2) {
      const left = below[i];
      const right = i + 1 < below.length ? below[i + 1] : this.zeros[level - 1];
      out.push(this.hash2(left, right));
    }
    return out;
  }

  root() {
    const top = this._layer(this.levels);
    return top.length ? top[0] : this.zeros[this.levels];
  }

  // Authentication path for the leaf at `index`.
  proof(index) {
    const pathElements = [];
    const pathIndices = [];
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const layer = this._layer(level);
      const siblingIdx = idx ^ 1;
      const sibling =
        siblingIdx < layer.length ? layer[siblingIdx] : this.zeros[level];
      pathElements.push(sibling);
      pathIndices.push(idx & 1); // 0 => we are the left child
      idx >>= 1;
    }
    return { pathElements, pathIndices };
  }
}

// Encode a Stellar/G... address (or any string) into a field element by
// hashing its bytes down with Poseidon. Used to bind a withdrawal to a
// specific recipient inside the proof.
export function addressToField(str) {
  const bytes = Buffer.from(str, "utf8");
  let acc = 0n;
  for (const b of bytes) acc = (acc * 256n + BigInt(b)) % FIELD;
  return acc;
}

// Build the full witness input object for withdraw.circom.
export function buildWithdrawInput({
  note,
  depositsTree,
  associationTree,
  recipient, // field element
  fee = 0n,
}) {
  const di = depositsTree.indexOf(note.commitment);
  const ai = associationTree.indexOf(note.commitment);
  if (di < 0) throw new Error("note not in deposits tree");
  if (ai < 0)
    throw new Error("note not in approved association set (not compliant)");

  const dp = depositsTree.proof(di);
  const ap = associationTree.proof(ai);

  return {
    // public
    root: depositsTree.root().toString(),
    associationRoot: associationTree.root().toString(),
    nullifierHash: note.nullifierHash.toString(),
    recipient: recipient.toString(),
    fee: fee.toString(),
    // private
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
    pathElements: dp.pathElements.map(String),
    pathIndices: dp.pathIndices.map(String),
    assocPathElements: ap.pathElements.map(String),
    assocPathIndices: ap.pathIndices.map(String),
  };
}
