// Verify the proof written by 03_prove.mjs, and check that tampering with it
// is caught.
//
//   node scripts/04_verify.mjs      (or: npm run verify)
//
// Exits non-zero if the proof does not verify, or if a tampered proof is
// wrongly accepted, so this is usable as a build gate.

import * as snarkjs from "snarkjs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const NEEDED = [
  ["build/proof.json", "npm run prove"],
  ["build/public.json", "npm run prove"],
  ["build/verification_key.json", "npm run setup"],
];
for (const [path, hint] of NEEDED) {
  if (!existsSync(path)) {
    console.error(`✗ missing ${path}, run \`${hint}\` first`);
    process.exit(1);
  }
}

const proof = JSON.parse(readFileSync("build/proof.json"));
const publicSignals = JSON.parse(readFileSync("build/public.json"));
const vkey = JSON.parse(readFileSync("build/verification_key.json"));

const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
console.log(ok ? "✓ proof VALID" : "✗ proof INVALID");
if (!ok) process.exit(1);

// Flipping the recipient must invalidate the proof. This is the property the
// contract relies on when it refuses to pay an address the proof did not
// commit to: without it, the on-chain check would be comparing against a value
// an attacker could vary freely.
const tampered = [...publicSignals];
tampered[3] = (BigInt(tampered[3]) + 1n).toString();
const tamperedOk = await snarkjs.groth16.verify(vkey, tampered, proof);
console.log(
  tamperedOk
    ? "✗ tampered recipient was ACCEPTED. Payout binding is broken"
    : "✓ tampered recipient REJECTED"
);
if (tamperedOk) process.exit(1);

console.log(`✓ ${publicSignals.length} public signals, all checks passed`);

// snarkjs leaves worker threads running; exit explicitly so this terminates.
process.exit(0);
