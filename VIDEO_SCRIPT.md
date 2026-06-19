# Veil — 2–3 min demo video script

**Goal:** prove three things are *real and live on Stellar testnet* — (1) on-chain
ZK verification, (2) a private payout, (3) an auditor who can de-anonymize it.
Total target: **~2:45**. Spoken parts are written to be read at a normal pace.

## ⭐ Easiest path: one command, fully live (~8 seconds)

Run **`bash scripts/show.sh`** on camera. It hits the real testnet contract and
walks through all four beats — on-chain proof verification, the settled private
payout, the double-spend rejection, and the auditor trace — in about 8 seconds.
Narrate over it using the section headings below. This is the recommended take;
the shot-by-shot version after it is optional if you want to show the source
files and explorer too.

---

**Before you hit record — open these:**
- Terminal A (in `C:\Users\HP\veil`, PATH already set) — for running the demos.
- Browser tab 1: the withdraw tx on stellar.expert
  `https://stellar.expert/explorer/testnet/tx/1940d42bdf872828a1f1ec4ecd2fce08ff9b923e35ddb0b1802892dc7a8cc33a`
- Browser tab 2: the contract
  `https://stellar.expert/explorer/testnet/contract/CDP4K4VRHXAT5X7T3M6RSRPP57XPRAVRLPV2KDFA7YBMNPJRTPWNIXQ4`
- Editor open to `circuits/withdraw.circom` and `contracts/veil/src/lib.rs`.

> Tip: pre-run the live testnet demo once so balances are warm; in the recording
> you can run `audit_demo.mjs` live (it's fast) and *show* the deposit/withdraw
> from a pre-recorded run or the explorer to keep under 3 minutes.

---

## 0:00 – 0:25 · Hook & problem  *(on screen: title slide "Veil — compliant privacy pool on Stellar")*

> "Privacy pools let you withdraw to a fresh address so no one can link your
> payout to your deposit. The problem: a plain mixer is indistinguishable from
> money laundering, so no real institution will touch it.
> Veil fixes that — it's a privacy pool where every withdrawal *also* proves, in
> zero knowledge, that it came from a compliance-approved set. Privacy for honest
> users, exclusion of bad actors, in the same proof."

## 0:25 – 0:50 · What it is  *(on screen: withdraw.circom, then lib.rs scrolling to bn254 pairing_check)*

> "One Groth16 circuit proves four things at once: you own a real deposit, that
> same note is in the approved association set, its nullifier is unspent, and the
> recipient is bound in to stop front-running.
> And the proof is load-bearing — this Soroban contract releases nothing unless
> it verifies on-chain, using Stellar's brand-new Protocol 26 BN254 pairing host
> function. Not a mock. The real primitive."

## 0:50 – 1:25 · Demo 1 — real proof, verified on-chain  *(on screen: Terminal A)*

Run:
```bash
cd contracts/veil && cargo test
```
> "First, this isn't hand-waving. `cargo test` runs a *real* snarkjs proof
> through the actual Soroban BN254 host environment — it verifies, and a tampered
> input is rejected."

Switch to browser tab 2 (contract) / the verify tx.
> "And it's live on testnet — here's the deployed contract and the on-chain
> verification transaction returning true."

## 1:25 – 2:00 · Demo 2 — a real private payout  *(on screen: Terminal A + explorer)*

> "Now the whole flow with real money. Five people deposit native XLM into the
> pool. One recipient withdraws — by submitting a proof — to a brand-new address."

Show the balances result (from a pre-run of `bash scripts/deploy/testnet_demo.sh`):
> "The pool drops by one note, the fresh address gains exactly one XLM, and
> nothing on-chain links that payout to any specific deposit."

Switch to browser tab 1 (withdraw tx).
> "Here's that withdrawal on the explorer. And if anyone tries to replay the same
> proof, the contract rejects it — nullifier already used. No double-spends."

## 2:00 – 2:40 · Demo 3 — the auditor view-key  *(on screen: Terminal A — THE differentiator)*

Run live:
```bash
node scripts/audit_demo.mjs
```
> "Here's what makes Veil real-world. A regulator holds a view-key. Every deposit
> publishes an encrypted record *on-chain*. To the public it's just ciphertext —
> withdrawals stay private.
> But the auditor decrypts every record... and traces this anonymous withdrawal
> back to a real identity — Fatima Sani, Payroll #003 — the exact note that was
> spent. Privacy for the public, full auditability for the regulator."

## 2:40 – 2:55 · Close  *(on screen: title slide with links)*

> "Real zero-knowledge, verified on-chain with Protocol 26 BN254, a live private
> payout, compliance built in, and selective disclosure for regulators — exactly
> the real-world ZK Stellar is asking for. That's Veil."

*(Show on slide: contract `CDP4K4VR…IXQ4`, repo link, "Built on BN254 / Protocol 26".)*

---

## One-take fallback (if you'd rather not cut)
Pre-run `bash scripts/deploy/testnet_demo.sh` so the chain state exists, then on
camera run only `node scripts/audit_demo.mjs` live and narrate the explorer tabs
for Demos 1–2. Keeps it to a single terminal and well under 3 minutes.
