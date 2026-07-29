// Veil end-to-end demo (off-chain proving).
//
// Story: a payroll/aid pool receives several deposits. A compliance reviewer
// approves a subset (the "association set"). A recipient then withdraws their
// note PRIVATELY. The proof reveals nothing about which deposit it was, only
// that (a) it exists in the pool and (b) it is in the approved set, and (c) it
// has not been spent before. We also show that a NON-approved note cannot
// produce a valid compliant proof. The privacy is auditable by construction.

import * as snarkjs from "snarkjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

import { buildWithdrawInput } from "./lib/veil.mjs";
import { buildPool, RECIPIENT, RELAYER } from "./lib/scenario.mjs";

const WASM = "build/withdraw_js/withdraw.wasm";
const ZKEY = "build/withdraw_final.zkey";

function banner(t) {
  console.log("\n" + "═".repeat(64) + "\n  " + t + "\n" + "═".repeat(64));
}

async function main() {
  banner("1. Build the pool and make deposits");
  const { notes, deposits, approved } = await buildPool();
  notes.forEach((n, i) => {
    console.log(`  deposit #${i} commitment = ${n.commitment.toString().slice(0, 18)}…`);
  });

  banner("2. Compliance reviewer approves a subset (association set)");
  console.log("  approved notes: #0 #1 #2 #3   (note #4 NOT approved)");
  console.log("  depositsRoot    =", deposits.root().toString());
  console.log("  associationRoot =", approved.root().toString());

  banner("3. Recipient privately withdraws an APPROVED note (#2)");
  console.log("  recipient =", RECIPIENT);
  console.log("  relayer   =", RELAYER, "(submits the tx, takes a fee)");
  const input = buildWithdrawInput({
    note: notes[2],
    depositsTree: deposits,
    associationTree: approved,
    recipient: RECIPIENT,
    relayer: RELAYER,
    fee: 1_0000000n,
  });

  console.log("  generating Groth16 proof (this is the real ZK step) ...");
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  console.log(`  ✓ proof generated in ${Date.now() - t0} ms`);

  writeFileSync("build/proof.json", JSON.stringify(proof, null, 2));
  writeFileSync("build/public.json", JSON.stringify(publicSignals, null, 2));
  console.log("  public signals [root, assocRoot, nullifierHash,");
  console.log("                  recipientHi, recipientLo, relayerHi, relayerLo, fee]:");
  publicSignals.forEach((s) => console.log("    " + s));

  banner("4. Verify the proof (what the Soroban contract will do on-chain)");
  const vkey = JSON.parse(
    (await import("node:fs")).readFileSync("build/verification_key.json")
  );
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log(ok ? "  ✓ PROOF VALID, contract would release payout" : "  ✗ INVALID");
  if (!ok) process.exit(1);

  banner("5. Compliance gate: a NON-approved note (#4) cannot prove membership");
  try {
    buildWithdrawInput({
      note: notes[4],
      depositsTree: deposits,
      associationTree: approved, // note #4 is absent here
      recipient: RECIPIENT,
      relayer: RELAYER,
      fee: 0n,
    });
    console.log("  ✗ unexpectedly built an input, gate broken!");
    process.exit(1);
  } catch (e) {
    console.log("  ✓ blocked:", e.message);
    console.log("    (a flagged deposit is private but provably NOT withdrawable)");
  }

  banner("DONE: real ZK, compliant privacy, ready for on-chain verification");
}

main().then(() => process.exit(0));
