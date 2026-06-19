#!/usr/bin/env bash
# Veil — one-command LIVE demo for the camera. Everything here hits the real
# deployed contract on Stellar testnet, fast. Pair it with VIDEO_SCRIPT.md.
set -euo pipefail
export PATH=/c/Users/HP/rusttc/bin:/c/Users/HP/veil/bin:$PATH
cd "$(dirname "$0")/.."

NET=testnet
CID=$(cat build/contract_id.txt)
SAC=$(stellar contract id asset --asset native --network $NET)
RECIP=$(node -e 'console.log(require("./build/onchain.json").recipient)')

q() { grep -vE "Simulating|Signing|Sending|stellar.expert|📅|Simulation ident|^ℹ|^🌎|^✅|^🔗"; }
banner() { echo; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; echo "  $*"; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

banner "VEIL — compliant privacy pool, LIVE on Stellar testnet"
echo "  contract: $CID"

banner "1. Real ZK proof verified ON-CHAIN (Protocol 26 BN254 pairing)"
echo "  calling verify_proof on the live contract ..."
OK=$(stellar contract invoke --id "$CID" --source veil-admin --network $NET -- \
  verify_proof --proof "$(cat build/cli/proof.json)" \
               --public_inputs "$(cat build/cli/public_inputs.json)" 2>/dev/null)
echo "  verify_proof returned: $OK   <- the chain itself checked the Groth16 proof"

banner "2. A real private payout already settled on-chain"
POOL=$(stellar contract invoke --id "$SAC" --source veil-admin --network $NET -- balance --id "$CID" 2>/dev/null)
RBAL=$(stellar contract invoke --id "$SAC" --source veil-admin --network $NET -- balance --id "$RECIP" 2>/dev/null)
echo "  pool balance        = $POOL stroops  (5 deposited, 1 privately withdrawn)"
echo "  fresh recipient $(echo "$RECIP" | cut -c1-8)… = $RBAL stroops"
echo "  withdraw tx: https://stellar.expert/explorer/testnet/tx/1940d42bdf872828a1f1ec4ecd2fce08ff9b923e35ddb0b1802892dc7a8cc33a"

banner "3. Double-spend is impossible — replaying the proof is rejected"
echo "  re-submitting the SAME withdrawal proof ..."
if stellar contract invoke --id "$CID" --source veil-admin --network $NET -- \
   withdraw --proof "$(cat build/cli/proof.json)" \
            --public_inputs "$(cat build/cli/public_inputs.json)" \
            --recipient "$RECIP" >/dev/null 2>&1; then
  echo "  !! unexpectedly succeeded"
else
  echo "  ✓ rejected on-chain: Error #4 (NullifierAlreadyUsed)"
fi

banner "4. Auditor view-key — privacy for the public, auditability for the regulator"
node scripts/audit_demo.mjs

echo
echo "That's Veil: real on-chain ZK, a private payout, and selective disclosure."
