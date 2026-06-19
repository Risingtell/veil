// Veil — prepare a FULL on-chain deposit→withdraw demo on testnet.
//
// Unlike demo.mjs (which only proves + verifies off-chain), this script binds
// the withdrawal to a REAL Stellar recipient address and emits every artifact
// the on-chain flow needs:
//   - build/proof.json / build/public.json   (consumed by 05_export.mjs)
//   - build/onchain.json                      (commitments, roots, recipient)
//
// The recipient G-address is passed in via RECIPIENT env var, because it is a
// PUBLIC INPUT bound into the proof — the payout is cryptographically tied to
// exactly that address.
import * as snarkjs from "snarkjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

import {
  LEVELS,
  makeHasher,
  makeNote,
  MerkleTree,
  addressToField,
  buildWithdrawInput,
} from "./lib/veil.mjs";
import { buildAudit } from "./lib/audit.mjs";

// Human-readable identities the regulator's KYC registry maps to. Each deposit
// carries an encrypted record of (identity, nullifier) for the auditor.
const IDENTITIES = [
  "Aisha Bello — Payroll #001",
  "Chidi Okafor — Payroll #002",
  "Fatima Sani — Payroll #003",
  "Emeka Eze — Payroll #004",
  "FLAGGED ACCOUNT — Payroll #005",
];

const WASM = "build/withdraw_js/withdraw.wasm";
const ZKEY = "build/withdraw_final.zkey";

const RECIPIENT = process.env.RECIPIENT;
if (!RECIPIENT) throw new Error("set RECIPIENT=<G... address> in the environment");
const DENOM_STROOPS = process.env.DENOM_STROOPS || "10000000"; // 1 XLM

// 32-byte big-endian hex (matches 05_export.mjs encoding for BytesN<32>).
function hex32(dec) {
  return (BigInt(dec) % (1n << 256n)).toString(16).padStart(64, "0");
}

async function main() {
  const { hash1, hash2 } = await makeHasher();
  const audit = await buildAudit();

  // 0. The regulator's view-key. (In production this lives only with the
  //    auditor; we generate it here so the demo can show decryption.)
  const auditor = audit.genKey();

  // 1. Pool of 5 fixed-denomination deposits.
  const deposits = new MerkleTree(LEVELS, hash2);
  const approved = new MerkleTree(LEVELS, hash2);
  const notes = Array.from({ length: 5 }, () => makeNote(hash1, hash2));
  notes.forEach((n) => deposits.insert(n.commitment));

  // Each deposit publishes an audit record encrypted to the auditor:
  //   record = (identityField, nullifier). Build the KYC registry too.
  const identityRegistry = {};
  const audits = notes.map((n, i) => {
    const idField = addressToField(IDENTITIES[i]);
    identityRegistry[hex32(idField)] = IDENTITIES[i];
    return audit.encrypt(auditor.pubPacked, [idField, n.nullifier]);
  });

  // 2. Compliance reviewer approves notes #0..#3 (note #4 flagged).
  [0, 1, 2, 3].forEach((i) => approved.insert(notes[i].commitment));

  // 3. Withdraw approved note #2, bound to the real recipient address.
  const recipientField = addressToField(RECIPIENT);
  const input = buildWithdrawInput({
    note: notes[2],
    depositsTree: deposits,
    associationTree: approved,
    recipient: recipientField,
    fee: 0n,
  });

  console.log("generating real Groth16 proof bound to", RECIPIENT, "...");
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  console.log(`  ✓ proof generated in ${Date.now() - t0} ms`);

  // sanity: verify off-chain before we ever touch the chain
  const vkey = JSON.parse(
    (await import("node:fs")).readFileSync("build/verification_key.json")
  );
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
    throw new Error("off-chain verify failed — aborting");
  }

  writeFileSync("build/proof.json", JSON.stringify(proof, null, 2));
  writeFileSync("build/public.json", JSON.stringify(publicSignals, null, 2));

  const WITHDRAWN = 2;
  const onchain = {
    token_sac: process.env.TOKEN_SAC || null,
    recipient: RECIPIENT,
    denom_stroops: DENOM_STROOPS,
    // every deposited commitment, as the contract's deposit() wants them
    commitments: notes.map((n) => hex32(n.commitment)),
    audits, // encrypted audit record per deposit (parallel to commitments)
    deposits_root: hex32(deposits.root()),
    association_root: hex32(approved.root()),
    nullifier_hash: hex32(notes[WITHDRAWN].nullifierHash),
    withdrawn_index: WITHDRAWN,
    // public inputs the circuit/contract expect: [root, assocRoot, nh, recip, fee]
    public_inputs: publicSignals.map(hex32),
    // auditor view-key + the regulator's KYC registry (off-chain in reality)
    auditor_pub_packed: auditor.pubPacked,
    auditor_priv: auditor.priv.toString(),
    identity_registry: identityRegistry,
  };
  writeFileSync("build/onchain.json", JSON.stringify(onchain, null, 2));

  console.log("  deposits_root   =", onchain.deposits_root);
  console.log("  association_root=", onchain.association_root);
  console.log("  nullifier_hash  =", onchain.nullifier_hash);
  console.log("  auditor pubkey  =", onchain.auditor_pub_packed);
  console.log("✓ wrote build/onchain.json + build/proof.json + build/public.json");
}

main().then(() => process.exit(0));
