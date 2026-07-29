// Veil shared library: Poseidon hashing, fixed-depth Merkle trees, and note
// helpers. These mirror exactly what the Circom circuit computes, so an input
// generated here will satisfy the constraints in withdraw.circom.

import { buildPoseidon } from "circomlibjs";
import { createHash, randomBytes } from "node:crypto";

export const LEVELS = 20;
// BN254 scalar field modulus: the field every signal lives in.
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

// Encode an arbitrary label (an identity string in the auditor's registry)
// into a field element. SHA-256 truncated to 248 bits: comfortably inside the
// field, and collision-resistant, so two payroll records cannot share an
// encrypted identity slot.
export function labelToField(str) {
  const digest = createHash("sha256").update(str, "utf8").digest();
  return BigInt("0x" + digest.subarray(0, 31).toString("hex"));
}

// Encode a Stellar address into the two field elements the circuit commits to,
// matching contracts/veil/src/address_bind.rs exactly.
//
// A Soroban address is a 32-byte payload plus a type discriminant (0 for an
// account G..., 1 for a contract C...). That is 33 bytes, which does not fit in
// one 254-bit field element, so it is split:
//
//   buf = [kind] ++ payload[0..32]     (33 bytes)
//   hi  = big-endian buf[0..17]        (136 bits)
//   lo  = big-endian buf[17..33]       (128 bits)
//
// The split is injective and involves no hashing, so the contract's check is a
// plain byte comparison with nothing to collide.
//
// The previous encoding folded the 56-character strkey down modulo the field,
// which was neither injective nor checked on-chain at all.
export function addressToLimbs(strkey) {
  const { kind, payload } = decodeStrkey(strkey);
  const buf = Buffer.concat([Buffer.from([kind]), payload]);
  const be = (slice) => BigInt("0x" + slice.toString("hex"));
  return { hi: be(buf.subarray(0, 17)), lo: be(buf.subarray(17, 33)) };
}

// Decode a Stellar strkey (G... account or C... contract) to its raw 32-byte
// payload, verifying the version byte and CRC-16 checksum rather than trusting
// the string. A malformed address must fail here, not silently bind to
// something the contract will refuse.
export function decodeStrkey(strkey) {
  const data = base32Decode(strkey);
  if (data.length !== 35) {
    throw new Error(`bad strkey length for ${strkey}`);
  }
  const version = data[0];
  const payload = data.subarray(1, 33);
  const checksum = data.readUInt16LE(33);
  if (crc16(data.subarray(0, 33)) !== checksum) {
    throw new Error(`bad strkey checksum for ${strkey}`);
  }
  // 6 << 3 = 0x30 -> 'G' (ed25519 public key); 2 << 3 = 0x10 -> 'C' (contract).
  if (version === 6 << 3) return { kind: 0, payload };
  if (version === 2 << 3) return { kind: 1, payload };
  throw new Error(`unsupported strkey version byte 0x${version.toString(16)}`);
}

// Encode a 32-byte payload as a Stellar strkey. Used to mint valid demo
// addresses rather than placeholder strings, so the demo exercises the same
// decode-and-verify path a real address goes through.
export function encodeStrkey(payload, kind = 0) {
  if (payload.length !== 32) throw new Error("payload must be 32 bytes");
  const version = kind === 0 ? 6 << 3 : 2 << 3;
  const data = Buffer.concat([Buffer.from([version]), Buffer.from(payload)]);
  const sum = Buffer.alloc(2);
  sum.writeUInt16LE(crc16(data), 0);
  return base32Encode(Buffer.concat([data, sum]));
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, "")) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 character ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

// CRC-16/XMODEM, as used by SEP-23 strkeys.
function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

// Build the full witness input object for withdraw.circom.
//
// `recipient` and `relayer` are Stellar strkeys. `relayer` defaults to the
// recipient with a zero fee, which is the "user pays their own gas" case.
export function buildWithdrawInput({
  note,
  depositsTree,
  associationTree,
  recipient, // strkey, e.g. "G..."
  relayer = recipient,
  fee = 0n,
}) {
  const di = depositsTree.indexOf(note.commitment);
  const ai = associationTree.indexOf(note.commitment);
  if (di < 0) throw new Error("note not in deposits tree");
  if (ai < 0)
    throw new Error("note not in approved association set (not compliant)");

  const dp = depositsTree.proof(di);
  const ap = associationTree.proof(ai);
  const r = addressToLimbs(recipient);
  const l = addressToLimbs(relayer);

  return {
    // public
    root: depositsTree.root().toString(),
    associationRoot: associationTree.root().toString(),
    nullifierHash: note.nullifierHash.toString(),
    recipientHi: r.hi.toString(),
    recipientLo: r.lo.toString(),
    relayerHi: l.hi.toString(),
    relayerLo: l.lo.toString(),
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
