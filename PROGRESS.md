# Veil — progress & resume notes

Last updated: 2026-06-19. Hackathon deadline: **2026-06-29 20:00**.

## ✅ DONE (working, verified, committed)
- **ZK circuit** `circuits/withdraw.circom` (dual Merkle membership + nullifier),
  10,175 constraints, compiles.
- **Real Groth16 proof** generates + verifies off-chain (`npm run demo`).
  Compliance gate blocks non-approved notes.
- **Trusted setup** done (vk in `build/verification_key.json`).
- **BN254 Soroban contract** `contracts/veil/src/lib.rs` — Groth16 verifier
  (Protocol 26 `bn254().pairing_check`) + privacy pool. `cargo test` passes
  (real proof verifies + tampered input rejected).
- **DEPLOYED TO TESTNET** and verified on-chain:
  - Contract: `CDYIWITNVAI5CJ5BUU2WI7KNSBPPG7BHM4EBY2JSAEHJG4KMUEEPP3YX`
  - `verify_proof` -> `true`, permanent tx:
    `85e0003da72fc087160a097ebd2178e9a2bb1b0f660fa241ba28d1f54a49f2ca`
  - Init tx: `c627e5ca9ceb451b72d9197d695008fa98dd9ce627ce0b24e1556edaeb6550b7`
- **FULL deposit→withdraw demo LIVE on testnet** (native XLM SAC):
  - Demo contract: `CBJZLA6NRAOY5TL3WBBB6RF7X65RUNBRRTTBLJK2SYR67SGHTS3UGZB4`
  - Native SAC token: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`, denom 1 XLM
  - 5 real deposits → publish_root + set_association_root → withdraw paid
    **1 XLM privately to a fresh recipient** `GDK3XQFVN5ECZQSJIKLSJ7B3W4QGB2Q2PVBCKRLZQHPIC4G6J6CI2EBB`
  - Withdraw tx: `d6e6c9652ad8e39ff30ed405b15ed7338e20dc452bdf3194b75b611ada79f0ea`
  - Pool 5→4 XLM, recipient +1 XLM; **replay rejected on-chain (Error #4 NullifierAlreadyUsed)**.
  - Reproducible: `RECIPIENT=<G..> node scripts/onchain_demo.mjs && node scripts/05_export.mjs && node scripts/deploy/cli_args.mjs && bash scripts/deploy/testnet_demo.sh`
- Registered as Hacker on DoraHacks (not yet submitted).

## ⏭️ TODO (next session)
1. **Auditor view-key / selective-disclosure** differentiator (uniqueness wedge).
2. **Push to GitHub** (needs the user's account) — repo is committed locally.
3. **Record 2–3 min demo video** (submission requirement).
4. **Submit BUIDL** on DoraHacks before the deadline.

## 🔧 Environment / how to resume
Tools are NOT on the global PATH. Prepend them:
```bash
export PATH=/c/Users/HP/rusttc/bin:/c/Users/HP/veil/bin:$PATH
```
- Rust (GNU standalone): `C:\Users\HP\rusttc\bin` (rustc/cargo 1.96.0)
- Stellar CLI 27.0.0 + circom 2.1.9: `C:\Users\HP\veil\bin`
- Testnet identity alias: `veil-admin` (`GA53TUTIPQNNWOMSY4ANNC3EPNP6ZBFOEETKRKOVGHVR2E33F6647IHG`)

### Key commands
```bash
# off-chain proof
npm run compile && npm run setup && npm run demo
node scripts/05_export.mjs            # -> Soroban bytes + Rust fixture + cli args

# contract (in contracts/veil)
cargo test                             # host verify (real proof)
cargo build --target wasm32v1-none --release   # deployable wasm (NOT wasm32-unknown-unknown!)

# deploy/invoke (RPC https://soroban-testnet.stellar.org)
stellar contract deploy --wasm target/wasm32v1-none/release/veil.wasm --source veil-admin --network testnet
stellar contract invoke --id <CID> --source veil-admin --network testnet -- verify_proof \
  --proof "$(cat build/cli/proof.json)" --public_inputs "$(cat build/cli/public_inputs.json)"
```

## ⚠️ Gotchas learned
- soroban-sdk 26 requires `--target wasm32v1-none` (rejects wasm32-unknown-unknown).
- This network stalls large downloads via rustup/node-fetch; use `curl` (and
  parallel connections). Rust installed via tarballs, not rustup.
- BN254 G2 byte encoding needs the coefficient swap (handled in `05_export.mjs`).
