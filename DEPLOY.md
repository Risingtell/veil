# Deploying & verifying Veil on Stellar testnet

This walks through building the contract to WASM, running the on-chain
verification test, and deploying + invoking on Stellar **testnet**.

## Prerequisites
- Rust (GNU toolchain on Windows) + `wasm32-unknown-unknown` target.
- Stellar CLI (`bin/stellar.exe` here, or install from developers.stellar.org).
- A funded testnet identity.

## 1. Verify the real proof in the Soroban host (no network needed)
```bash
cd contracts/veil
cargo test            # runs verifies_real_proof + rejects_tampered_public_input
```
A green `verifies_real_proof` means the exact snarkjs proof in
`src/fixture.rs` is accepted by the **BN254 pairing host function** — this is
genuine on-chain-equivalent ZK verification.

## 2. Build the contract to WASM
```bash
stellar contract build
# or: cargo build --target wasm32-unknown-unknown --release
```
Output: `target/wasm32-unknown-unknown/release/veil.wasm`

## 3. Create & fund a testnet identity
```bash
stellar keys generate veil-admin --network testnet --fund
stellar keys address veil-admin
```

## 4. Deploy
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/veil.wasm \
  --source veil-admin --network testnet
# -> prints CONTRACT_ID
```

## 5. Initialize with the verification key
The verification key bytes are in `build/soroban_inputs.json` (`vk` field).
Initialization passes a `VkBytes` struct. Because the struct is large, use the
JSON-arg form (`--vk-file`) or the helper script:
```bash
node ../../scripts/deploy/invoke_init.mjs <CONTRACT_ID> <TOKEN_ADDR> <DENOM>
```

## 6. Verify a proof on testnet
```bash
node ../../scripts/deploy/invoke_verify.mjs <CONTRACT_ID>
# Reads build/soroban_inputs.json, calls verify_proof, prints true/false + tx hash
```

## Notes
- Testnet resets periodically; redeploy if the contract disappears.
- For a full deposit→withdraw demo you also need a token (USDC test SAC or a
  custom test token) and to call `deposit`, `publish_root`,
  `set_association_root`, then `withdraw`.
- Current submission status of each step is tracked in the project README.
