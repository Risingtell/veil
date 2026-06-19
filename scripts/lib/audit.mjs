// Veil — auditor view-key (selective disclosure).
//
// A designated regulator holds a BabyJubJub keypair. At deposit time the
// depositor encrypts an audit record — the depositor's identity and the note's
// nullifier — to the auditor's PUBLIC key and publishes the ciphertext on-chain.
//
// The public learns nothing (commitments and nullifier hashes are unlinkable),
// but the auditor can open any record with their PRIVATE key and, by hashing the
// recovered nullifier, link a deposit to the exact withdrawal that spent it.
//
// Scheme: hybrid (ElGamal-style) encryption with a Poseidon stream cipher —
//   r  <- random scalar         R = r·G                 (ephemeral pubkey)
//   S  = r·AuditorPub           (= auditorPriv·R)        (shared secret point)
//   ctᵢ = mᵢ + Poseidon(Sx, Sy, i)   mod p
// BabyJubJub is defined over the BN254 scalar field, so every value (nullifier,
// Sx, Sy, Poseidon output) lives in the SAME field as the circuit signals —
// which is exactly what lets this be enforced in-circuit later if desired.
import { buildBabyjub, buildPoseidon } from "circomlibjs";
import { randomBytes } from "node:crypto";
import { FIELD } from "./veil.mjs";

function hex32(v) {
  return (BigInt(v) % (1n << 256n)).toString(16).padStart(64, "0");
}
function toBytes(hex) {
  return Buffer.from(hex, "hex");
}

export async function buildAudit() {
  const babyJub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = babyJub.F; // BN254 scalar field
  const subOrder = babyJub.subOrder;

  const randScalar = () =>
    (BigInt("0x" + randomBytes(32).toString("hex")) % (subOrder - 1n)) + 1n;
  const poseidonBig = (arr) => poseidon.F.toObject(poseidon(arr));

  // Generate a regulator keypair. Returns the private scalar and the packed
  // (32-byte) public key suitable for on-chain storage as BytesN<32>.
  function genKey() {
    const priv = randScalar();
    const pub = babyJub.mulPointEscalar(babyJub.Base8, priv);
    return {
      priv,
      pubPacked: Buffer.from(babyJub.packPoint(pub)).toString("hex"),
    };
  }

  // Encrypt an array of field-element messages to the auditor's packed pubkey.
  // Returns a hex string: packedR(32) || ct[0](32) || ct[1](32) || ...
  function encrypt(pubPacked, messages) {
    const pub = babyJub.unpackPoint(toBytes(pubPacked));
    const r = randScalar();
    const R = babyJub.mulPointEscalar(babyJub.Base8, r);
    const S = babyJub.mulPointEscalar(pub, r);
    const sx = F.toObject(S[0]);
    const sy = F.toObject(S[1]);
    let out = Buffer.from(babyJub.packPoint(R)).toString("hex");
    messages.forEach((m, i) => {
      const mask = poseidonBig([sx, sy, BigInt(i)]);
      const ct = (((BigInt(m) % FIELD) + mask) % FIELD + FIELD) % FIELD;
      out += hex32(ct);
    });
    return out;
  }

  // Decrypt with the auditor's private key. `count` = number of messages.
  function decrypt(priv, hex, count) {
    const buf = toBytes(hex);
    const R = babyJub.unpackPoint(buf.subarray(0, 32));
    const S = babyJub.mulPointEscalar(R, priv);
    const sx = F.toObject(S[0]);
    const sy = F.toObject(S[1]);
    const out = [];
    for (let i = 0; i < count; i++) {
      const ct = BigInt("0x" + buf.subarray(32 + i * 32, 64 + i * 32).toString("hex"));
      const mask = poseidonBig([sx, sy, BigInt(i)]);
      out.push(((ct - mask) % FIELD + FIELD) % FIELD);
    }
    return out;
  }

  // The same Poseidon(nullifier) the circuit reveals as nullifierHash, so the
  // auditor can match a decrypted record to an on-chain withdrawal.
  const nullifierHash = (nullifier) => poseidonBig([BigInt(nullifier)]);

  return { genKey, encrypt, decrypt, nullifierHash };
}
