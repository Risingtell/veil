// Generate a real Groth16 withdrawal proof and write it to build/.
//
//   node scripts/03_prove.mjs      (or: npm run prove)
//
// Builds a five-note pool with a four-note approved subset, then proves a
// withdrawal of one approved note to a specific recipient, paying a relayer a
// fee out of the note. Writes build/proof.json, build/public.json and
// build/witness_input.json.
//
// Requires `npm run compile` and `npm run setup` to have produced
// build/withdraw_js/withdraw.wasm and build/withdraw_final.zkey.

import * as snarkjs from "snarkjs";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

import { buildWithdrawInput } from "./lib/veil.mjs";
import { buildPool, RECIPIENT, RELAYER } from "./lib/scenario.mjs";

const WASM = "build/withdraw_js/withdraw.wasm";
const ZKEY = "build/withdraw_final.zkey";
const FEE = 1_0000000n; // 1 unit of the 10-unit note, paid to the relayer

for (const [path, hint] of [
  [WASM, "npm run compile"],
  [ZKEY, "npm run setup"],
]) {
  if (!existsSync(path)) {
    console.error(`✗ missing ${path}, run \`${hint}\` first`);
    process.exit(1);
  }
}

const { notes, deposits, approved } = await buildPool();

const input = buildWithdrawInput({
  note: notes[2],
  depositsTree: deposits,
  associationTree: approved,
  recipient: RECIPIENT,
  relayer: RELAYER,
  fee: FEE,
});

console.log("→ generating Groth16 proof ...");
const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
const ms = Date.now() - t0;

writeFileSync("build/proof.json", JSON.stringify(proof, null, 2));
writeFileSync("build/public.json", JSON.stringify(publicSignals, null, 2));
writeFileSync("build/witness_input.json", JSON.stringify(input, null, 2));

// The scenario behind the proof, so the contract's end-to-end test can rebuild
// the very same tree: deposit these commitments in this order and the contract
// derives the root this proof was generated against.
writeFileSync(
  "build/scenario.json",
  JSON.stringify(
    {
      commitments: notes.map((n) => n.commitment.toString()),
      approvedIndices: [0, 1, 2, 3],
      withdrawnIndex: 2,
      recipient: RECIPIENT,
      relayer: RELAYER,
      fee: FEE.toString(),
      associationRoot: approved.root().toString(),
      depositsRoot: deposits.root().toString(),
    },
    null,
    2
  )
);

console.log(`✓ proof generated in ${ms} ms`);
console.log(`  recipient = ${RECIPIENT}`);
console.log(`  relayer   = ${RELAYER}  (fee ${FEE})`);
console.log("  public signals [root, assocRoot, nullifierHash,");
console.log("                  recipientHi, recipientLo, relayerHi, relayerLo, fee]:");
for (const s of publicSignals) console.log("    " + s);
console.log("✓ wrote build/proof.json, build/public.json, build/witness_input.json");

// snarkjs and circomlibjs leave worker threads running, so the event loop never
// drains on its own. Exit explicitly, or this script hangs after printing its
// results, which reads as a hung build step to anything running it headlessly.
process.exit(0);
