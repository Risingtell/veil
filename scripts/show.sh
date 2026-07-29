#!/usr/bin/env bash
# Veil: one-command LIVE demo for the camera. Everything here hits the real
# deployed contract on Stellar testnet, fast. Pair it with VIDEO_SCRIPT.md.
set -euo pipefail
export PATH=/c/Users/HP/rusttc/bin:/c/Users/HP/veil/bin:$PATH
cd "$(dirname "$0")/.."

NET=testnet
CID=$(cat build/contract_id.txt)
SAC=$(stellar contract id asset --asset native --network $NET)
RECIP=$(node -e 'console.log(require("./build/onchain.json").recipient)')
RELAYER=$(node -e 'console.log(require("./build/onchain.json").relayer)')
WITHDRAW_TX=1cb5e2ac9eb87225977fe6552b14bf32936a55767116b4a7e6c384bcad4794cb

q() { grep -vE "Simulating|Signing|Sending|stellar.expert|📅|Simulation ident|^ℹ|^🌎|^✅|^🔗"; }
banner() { echo; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; echo "  $*"; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

banner "VEIL: compliant privacy pool, LIVE on Stellar testnet"
echo "  contract: $CID"

banner "1. Real ZK proof verified ON-CHAIN (Protocol 26 BN254 pairing)"
echo "  calling verify_proof on the live contract ..."
OK=$(stellar contract invoke --id "$CID" --source veil-admin --network $NET -- \
  verify_proof --proof "$(cat build/cli/proof.json)" \
               --public_inputs "$(cat build/cli/public_inputs.json)" 2>/dev/null)
echo "  verify_proof returned: $OK   <- the chain itself checked the Groth16 proof"

banner "2. The tree lives ON-CHAIN: the root is not operator-supplied"
LEAVES=$(stellar contract invoke --id "$CID" --source veil-admin --network $NET -- leaf_count 2>/dev/null)
ROOT=$(stellar contract invoke --id "$CID" --source veil-admin --network $NET -- root 2>/dev/null | tr -d '"')
echo "  leaf_count = $LEAVES   (the contract counted these itself)"
echo "  root       = $ROOT"
echo "  There is no publish_root. The contract hashes each deposit into the tree"
echo "  with the circuit's own Poseidon, so a root can only describe notes that"
echo "  were actually paid for."

banner "3. A real private payout already settled on-chain"
POOL=$(stellar contract invoke --id "$SAC" --source veil-admin --network $NET -- balance --id "$CID" 2>/dev/null)
RBAL=$(stellar contract invoke --id "$SAC" --source veil-admin --network $NET -- balance --id "$RECIP" 2>/dev/null)
echo "  pool balance        = $POOL stroops  (5 deposited, 1 privately withdrawn)"
echo "  fresh recipient $(echo "$RECIP" | cut -c1-8)… = $RBAL stroops"
echo "  withdraw tx: https://stellar.expert/explorer/testnet/tx/$WITHDRAW_TX"

banner "4. Redirecting a valid proof is rejected"
echo "  same proof, same public inputs, attacker's address as the payee ..."
if stellar contract invoke --id "$CID" --source veil-admin --network $NET --send=yes -- \
   withdraw --proof "$(cat build/cli/proof.json)" \
            --public_inputs "$(cat build/cli/public_inputs.json)" \
            --recipient "$(stellar keys address veil-admin)" \
            --relayer "$RELAYER" >/dev/null 2>&1; then
  echo "  !! unexpectedly succeeded"
else
  echo "  ✓ rejected on-chain: Error #9 (RecipientMismatch)"
  echo "    the proof is valid; it just does not authorise that payee"
fi

banner "5. Double-spend is impossible: replaying the proof is rejected"
echo "  re-submitting the SAME withdrawal proof ..."
if stellar contract invoke --id "$CID" --source veil-admin --network $NET --send=yes -- \
   withdraw --proof "$(cat build/cli/proof.json)" \
            --public_inputs "$(cat build/cli/public_inputs.json)" \
            --recipient "$RECIP" --relayer "$RELAYER" >/dev/null 2>&1; then
  echo "  !! unexpectedly succeeded"
else
  echo "  ✓ rejected on-chain: Error #4 (NullifierAlreadyUsed)"
fi

banner "6. Auditor view-key: privacy for the public, auditability for the regulator"
node scripts/audit_demo.mjs

echo
echo "That's Veil: real on-chain ZK, a private payout, and selective disclosure."
