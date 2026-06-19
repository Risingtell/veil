// Veil — auditor selective-disclosure demo.
//
// Reads the LIVE on-chain encrypted audit records from the deployed contract,
// then shows two views of the very same data:
//   • the PUBLIC sees only ciphertext — withdrawals are unlinkable;
//   • the AUDITOR, with the view-key, decrypts each record, recovers the
//     depositor identity + nullifier, and traces the anonymous on-chain
//     withdrawal back to a real person.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

import { buildAudit } from "./lib/audit.mjs";

const oc = JSON.parse(readFileSync("build/onchain.json"));
const CID = readFileSync("build/contract_id.txt", "utf8").trim();

function banner(t) {
  console.log("\n" + "═".repeat(66) + "\n  " + t + "\n" + "═".repeat(66));
}

// Pull the audit records straight from the chain (proves they're on-chain).
function chainCall(fn) {
  const out = execSync(
    `stellar contract invoke --id ${CID} --source veil-admin --network testnet -- ${fn}`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  return JSON.parse(out);
}

async function main() {
  const audit = await buildAudit();

  banner("On-chain state pulled live from " + CID.slice(0, 10) + "…");
  const records = chainCall("audit_records");
  console.log(`  ${records.length} encrypted audit records stored on-chain`);

  banner("1. The PUBLIC view — ciphertext only, nothing linkable");
  console.log("  audit_records[0] =", records[0].slice(0, 48) + "…");
  console.log("  (a withdrawal reveals only a nullifier hash; which deposit it");
  console.log("   came from, and who deposited it, is cryptographically hidden)");

  banner("2. The AUDITOR view — open every record with the view-key");
  const byNullifierHash = {};
  records.forEach((hex, i) => {
    const [idField, nullifier] = audit.decrypt(BigInt(oc.auditor_priv), hex, 2);
    const idHex = (idField % (1n << 256n)).toString(16).padStart(64, "0");
    const identity = oc.identity_registry[idHex] || "(unknown — not in KYC registry)";
    const nh = (audit.nullifierHash(nullifier) % (1n << 256n))
      .toString(16)
      .padStart(64, "0");
    byNullifierHash[nh] = identity;
    console.log(`  deposit #${i}: ${identity}`);
  });

  banner("3. TRACE the anonymous withdrawal back to a real identity");
  const spent = oc.nullifier_hash;
  console.log("  on-chain withdrawal nullifierHash =", spent.slice(0, 24) + "…");
  const who = byNullifierHash[spent];
  console.log(`  recipient ${oc.recipient.slice(0, 10)}… was paid by:  >>> ${who} <<<`);
  console.log("\n  Privacy for the public, full auditability for the regulator —");
  console.log("  the same property SDF's real-world ZK track is asking for.");
}

main().then(() => process.exit(0));
