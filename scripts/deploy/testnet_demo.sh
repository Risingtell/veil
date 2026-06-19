#!/usr/bin/env bash
# Veil — full deposit -> withdraw demo on Stellar testnet, using the native XLM
# Stellar Asset Contract (SAC) as the pool token. Prove privacy AND compliance
# with a real on-chain payout to a fresh recipient.
#
# Prereqs (already produced by scripts/onchain_demo.mjs + 05_export + cli_args):
#   build/cli/vk.json  build/cli/proof.json  build/cli/public_inputs.json
#   build/onchain.json
set -euo pipefail

export PATH=/c/Users/HP/rusttc/bin:/c/Users/HP/veil/bin:$PATH
cd "$(dirname "$0")/../.."

NET=testnet
ADMIN=veil-admin
RECIP_ID=veil-recipient
WASM=contracts/veil/target/wasm32v1-none/release/veil.wasm

SAC=$(stellar contract id asset --asset native --network $NET)
ADMIN_ADDR=$(stellar keys address $ADMIN)
RECIP_ADDR=$(stellar keys address $RECIP_ID)
DENOM=$(node -e 'console.log(require("./build/onchain.json").denom_stroops)')
DROOT=$(node -e 'console.log(require("./build/onchain.json").deposits_root)')
AROOT=$(node -e 'console.log(require("./build/onchain.json").association_root)')
AUDITOR=$(node -e 'console.log(require("./build/onchain.json").auditor_pub_packed)')

say() { echo; echo "=== $* ==="; }

say "1. Deploy a fresh Veil contract"
CID=$(stellar contract deploy --wasm "$WASM" --source $ADMIN --network $NET 2>/dev/null)
echo "  CID=$CID"
echo "$CID" > build/contract_id.txt

say "2. init (token = native XLM SAC, denom = $DENOM stroops, auditor view-key set)"
stellar contract invoke --id "$CID" --source $ADMIN --network $NET -- \
  init --admin "$ADMIN_ADDR" --token "$SAC" --denom "$DENOM" \
       --auditor "$AUDITOR" --vk "$(cat build/cli/vk.json)" >/dev/null
echo "  ✓ initialized; auditor pubkey $AUDITOR"

say "3. Deposit all 5 commitments + on-chain encrypted audit records"
N=$(node -e 'console.log(require("./build/onchain.json").commitments.length)')
for i in $(seq 0 $((N-1))); do
  C=$(node -e "console.log(require('./build/onchain.json').commitments[$i])")
  AU=$(node -e "console.log(require('./build/onchain.json').audits[$i])")
  stellar contract invoke --id "$CID" --source $ADMIN --network $NET -- \
    deposit --from "$ADMIN_ADDR" --commitment "$C" --audit "$AU" >/dev/null
  echo "  ✓ deposit #$i  ($C)"
done

say "4. publish_root + set_association_root"
stellar contract invoke --id "$CID" --source $ADMIN --network $NET -- \
  publish_root --root "$DROOT" >/dev/null
echo "  ✓ deposits root published:     $DROOT"
stellar contract invoke --id "$CID" --source $ADMIN --network $NET -- \
  set_association_root --root "$AROOT" >/dev/null
echo "  ✓ association (ASP) root set:  $AROOT"

say "5. Balances BEFORE withdraw"
POOL_BEFORE=$(stellar contract invoke --id "$SAC" --source $ADMIN --network $NET -- balance --id "$CID")
RECIP_BEFORE=$(stellar contract invoke --id "$SAC" --source $ADMIN --network $NET -- balance --id "$RECIP_ADDR")
echo "  pool      = $POOL_BEFORE"
echo "  recipient = $RECIP_BEFORE"

say "6. WITHDRAW — ZK proof releases payout to the fresh recipient"
WTX=$(stellar contract invoke --id "$CID" --source $ADMIN --network $NET --send=yes -- \
  withdraw --proof "$(cat build/cli/proof.json)" \
           --public_inputs "$(cat build/cli/public_inputs.json)" \
           --recipient "$RECIP_ADDR" 2>/dev/null)
echo "  ✓ withdraw returned: $WTX"

say "7. Balances AFTER withdraw"
POOL_AFTER=$(stellar contract invoke --id "$SAC" --source $ADMIN --network $NET -- balance --id "$CID")
RECIP_AFTER=$(stellar contract invoke --id "$SAC" --source $ADMIN --network $NET -- balance --id "$RECIP_ADDR")
echo "  pool      = $POOL_AFTER"
echo "  recipient = $RECIP_AFTER  (was $RECIP_BEFORE)"

echo
echo "Contract: $CID"
echo "Recipient $RECIP_ADDR received $DENOM stroops of native XLM, privately."
