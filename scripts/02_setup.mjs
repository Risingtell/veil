// Groth16 trusted setup: download Powers of Tau, run circuit-specific setup,
// add a contribution, and export the verification key.
import * as snarkjs from "snarkjs";
import { createWriteStream, existsSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const PTAU = "build/pot_final.ptau";
// 2^15 = 32768 constraints capacity — comfortably above our circuit size.
const PTAU_URLS = [
  "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau",
  "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau",
];

async function downloadPtau() {
  if (existsSync(PTAU)) {
    console.log("✓ Powers of Tau already present.");
    return;
  }
  for (const url of PTAU_URLS) {
    try {
      console.log(`→ Downloading Powers of Tau from ${url} ...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(PTAU));
      console.log("✓ Powers of Tau downloaded.");
      return;
    } catch (e) {
      console.warn(`  failed: ${e.message}`);
    }
  }
  throw new Error("Could not download Powers of Tau from any mirror.");
}

async function main() {
  await downloadPtau();

  console.log("→ Generating initial zkey (groth16 setup) ...");
  await snarkjs.zKey.newZKey("build/withdraw.r1cs", PTAU, "build/withdraw_0000.zkey");

  console.log("→ Contributing to the ceremony ...");
  await snarkjs.zKey.contribute(
    "build/withdraw_0000.zkey",
    "build/withdraw_final.zkey",
    "veil-hackathon-contributor",
    randomBytes(32).toString("hex")
  );

  console.log("→ Exporting verification key ...");
  const vkey = await snarkjs.zKey.exportVerificationKey("build/withdraw_final.zkey");
  writeFileSync("build/verification_key.json", JSON.stringify(vkey, null, 2));

  console.log("✓ Setup complete. build/withdraw_final.zkey + build/verification_key.json");
}

main().then(() => process.exit(0));
