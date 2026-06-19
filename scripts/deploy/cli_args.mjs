// Turn build/soroban_inputs.json into ready-to-use Stellar CLI argument values
// for `init` (verification key) and `verify_proof` (proof + public inputs).
//
// The Stellar CLI accepts complex contract args as JSON: a struct becomes a
// JSON object, a Vec becomes a JSON array, and a BytesN<N> becomes a hex string.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));

const inp = JSON.parse(readFileSync("build/soroban_inputs.json"));
mkdirSync("build/cli", { recursive: true });

// VkBytes struct
const vk = {
  alpha: inp.vk.alpha,
  beta: inp.vk.beta,
  gamma: inp.vk.gamma,
  delta: inp.vk.delta,
  ic: inp.vk.ic,
};

// ProofBytes struct
const proof = { a: inp.proof.a, b: inp.proof.b, c: inp.proof.c };

// Vec<BytesN<32>>
const publicInputs = inp.publicSignals;

writeFileSync("build/cli/vk.json", JSON.stringify(vk));
writeFileSync("build/cli/proof.json", JSON.stringify(proof));
writeFileSync("build/cli/public_inputs.json", JSON.stringify(publicInputs));

console.log("✓ Wrote build/cli/{vk,proof,public_inputs}.json");
console.log("\nExample invoke (after deploy):");
console.log(
  "  stellar contract invoke --id $CID --source veil-admin --network testnet \\\n" +
    "    -- verify_proof \\\n" +
    "    --proof  '" + JSON.stringify(proof).slice(0, 60) + "...' \\\n" +
    "    --public_inputs '" + JSON.stringify(publicInputs) + "'"
);
