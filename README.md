# Veil — a Compliant Privacy Pool for USDC on Stellar

> Private payouts that carry their own proof of compliance.
> Zero-knowledge withdrawals verified **on-chain** by a Soroban contract using
> the brand-new **Protocol 26 BN254 pairing** host function.

**Hackathon:** Stellar Hacks: Real-World ZK (SDF / DoraHacks).
**Track:** Open innovation — leaning into the 🟠 *"compliant privacy pool with ASP integration"* idea SDF flags as the real-world sweet spot.

### ✅ Live on Stellar testnet
- **Verifier contract:** `CDYIWITNVAI5CJ5BUU2WI7KNSBPPG7BHM4EBY2JSAEHJG4KMUEEPP3YX`
  — on-chain `verify_proof` → `true`:
  [85e0003d…](https://stellar.expert/explorer/testnet/tx/85e0003da72fc087160a097ebd2178e9a2bb1b0f660fa241ba28d1f54a49f2ca)
- **Full pool demo contract:** `CDP4K4VRHXAT5X7T3M6RSRPP57XPRAVRLPV2KDFA7YBMNPJRTPWNIXQ4`
  — real deposit→withdraw of native XLM: 5 deposits, then a ZK withdrawal paid
  **1 XLM privately** to a fresh address
  ([withdraw tx 1940d42b…](https://stellar.expert/explorer/testnet/tx/1940d42bdf872828a1f1ec4ecd2fce08ff9b923e35ddb0b1802892dc7a8cc33a)),
  with on-chain double-spend rejection.
- A **real** Circom/snarkjs Groth16 proof, verified by Stellar's Protocol 26
  **BN254 `pairing_check`** host function, inside the deployed contract.
- **Auditor view-key**: every deposit publishes an on-chain encrypted record that
  only a designated regulator can open — privacy for the public, full
  auditability for the regulator (`node scripts/audit_demo.mjs`).

---

## TL;DR — what it is and why it's different

A **privacy pool** lets you deposit funds and later withdraw to a *fresh,
unlinkable* address, so on-chain nobody can connect your payout to your deposit.
The problem with naive pools (mixers) is that they're indistinguishable from
money laundering, so institutions won't touch them.

**Veil** fixes that the way the [Privacy Pools paper](https://privacypools.com/whitepaper.pdf)
(Buterin, Illum, Nadler, Schär, Soleimani) proposes: every withdrawal proves, in
zero knowledge, that the note also belongs to an **approved association set**
curated by an Association Set Provider (ASP). So you get **privacy for honest
users and exclusion of bad actors at the same time** — the "compliant privacy"
sweet spot.

The zero-knowledge proof is **load-bearing**: the Soroban contract releases
*nothing* unless a valid proof verifies on-chain. Remove the ZK and the product
does not exist.

### Real-world framing (the demo)
Veil is shown as **confidential payroll / aid disbursement**: an employer or NGO
funds the pool; recipients withdraw their stipend privately to a fresh wallet;
individual payouts are unlinkable on-chain, yet every recipient is provably from
a screened, approved set, and a designated auditor can de-anonymize any payout
on demand via the on-chain view-key records (see *Auditor view-key* below).

---

## What the ZK proves

A single Groth16 proof (`circuits/withdraw.circom`) demonstrates, without
revealing the note or which deposit it is, that **all** of the following hold:

1. The prover knows the opening `(nullifier, secret)` of a commitment
   `C = Poseidon(nullifier, secret)`.
2. `C` is a leaf of the **deposits Merkle tree** (`root`).
3. The **same** `C` is a leaf of the **approved association tree**
   (`associationRoot`) — the compliance gate.
4. The revealed `nullifierHash = Poseidon(nullifier)` matches the note, so it can
   be spent **only once** (anti-double-spend).
5. `recipient` and `fee` are bound into the proof, defeating front-running /
   proof malleability.

Public inputs (in order): `[root, associationRoot, nullifierHash, recipient, fee]`.

> Poseidon is used deliberately — it's ZK-friendly **and** a native Stellar host
> function (Protocol 25), so the same primitive lives on both sides.

---

## Auditor view-key — privacy *and* auditability

A naive privacy pool is opaque even to a legitimate regulator. Veil adds a
**selective-disclosure** layer: a designated auditor holds a **BabyJubJub**
keypair, and at deposit time the depositor encrypts an audit record —
`(identity, nullifier)` — to the auditor's public key and **publishes the
ciphertext on-chain**. So the regulator's ability to investigate never depends
on a depositor voluntarily keeping records.

- **The public** sees only ciphertext; withdrawals stay unlinkable.
- **The auditor**, with the view-key, decrypts any record and — by hashing the
  recovered nullifier to the same `nullifierHash` the withdrawal reveals — traces
  an anonymous payout back to a real identity.

The scheme is ElGamal-style hybrid encryption with a Poseidon stream cipher over
BabyJubJub (the embedded curve of BN254), so every value lives in the same field
as the circuit signals — which means the correctness of an audit record can be
enforced *inside the circuit* as a natural next step. See `scripts/lib/audit.mjs`
and run the live demo with `node scripts/audit_demo.mjs`.

---

## How Stellar verifies it (the load-bearing part)

`contracts/veil` is a Soroban contract that verifies the proof on-chain with the
**Protocol 26 BN254 host functions** — `env.crypto().bn254()`:

```
Groth16 check  ==  e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1
                   vk_x = IC₀ + Σ publicᵢ · ICᵢ₊₁
```

implemented as one `bn254().pairing_check(g1_vec, g2_vec)` call, with `vk_x`
accumulated via `bn254().g1_mul` / `g1_add`. We chose **BN254** (not the older
BLS12-381 examples) precisely because Protocol 26's new BN254 pairing is what
this hackathon was created to exercise, and it's Ethereum-precompile-compatible.

The contract also implements the pool:
`init` · `deposit` · `publish_root` · `set_association_root` · `withdraw` ·
`verify_proof` · `auditor` · `audit_records` · `commitments`. `withdraw` checks
the deposit root is known, the association root matches the ASP, the nullifier is
unused, **verifies the proof**, then pays out. `deposit` additionally stores the
encrypted auditor record on-chain.

---

## Repository layout

```
circuits/
  withdraw.circom      # the ZK circuit (dual Merkle membership + nullifier)
  merkle.circom        # Poseidon Merkle proof gadget
contracts/veil/
  src/lib.rs           # Soroban BN254 Groth16 verifier + privacy pool
  src/test.rs          # verifies a REAL proof in the Soroban host env
  src/fixture.rs       # auto-generated real-proof bytes (by 05_export.mjs)
scripts/
  01_compile.mjs       # circom -> r1cs + wasm
  02_setup.mjs         # Powers of Tau + Groth16 trusted setup
  demo.mjs             # full off-chain story (deposit -> private withdraw)
  onchain_demo.mjs     # prepare a real testnet deposit->withdraw (+ audit records)
  audit_demo.mjs       # auditor opens on-chain records, traces a withdrawal
  05_export.mjs        # snarkjs JSON -> Soroban byte layout (EIP-197) + fixture
  lib/veil.mjs         # Poseidon + Merkle helpers (match the circuit exactly)
  lib/audit.mjs        # auditor view-key (Poseidon-ElGamal over BabyJubJub)
  deploy/testnet_demo.sh   # one-shot live testnet deposit->withdraw demo
bin/circom.exe         # circom 2.1.9 compiler
```

## Run it

```bash
npm install
npm run compile          # compile the circuit (10,175 constraints)
npm run setup            # trusted setup (downloads Powers of Tau)
npm run demo             # generate + verify a REAL proof, off-chain
node scripts/05_export.mjs   # produce Soroban inputs + Rust test fixture

# on-chain verification (real Groth16 proof, real BN254 host functions):
cd contracts/veil && cargo test

# full live testnet demo: deposit -> private withdraw of native XLM
RECIPIENT=<G...address> node scripts/onchain_demo.mjs
node scripts/05_export.mjs && node scripts/deploy/cli_args.mjs
bash scripts/deploy/testnet_demo.sh
node scripts/audit_demo.mjs   # regulator traces the anonymous withdrawal
```

---

## Status — honest notes

- **ZK proving (off-chain): working.** `npm run demo` generates and verifies a
  real Groth16 proof, and demonstrates that a non-approved note cannot produce a
  compliant proof.
- **On-chain verification: LIVE on testnet.** The deployed contract verifies the
  *same* real proof via the BN254 host functions. Evidence: contract
  `CDYIWITNVAI5CJ5BUU2WI7KNSBPPG7BHM4EBY2JSAEHJG4KMUEEPP3YX`, verify tx
  `85e0003da72fc087160a097ebd2178e9a2bb1b0f660fa241ba28d1f54a49f2ca`. Also
  reproducible offline via `cargo test` (host environment) — see `DEPLOY.md`.
- **Full deposit→withdraw of native XLM: LIVE on testnet.** Contract
  `CDP4K4VRHXAT5X7T3M6RSRPP57XPRAVRLPV2KDFA7YBMNPJRTPWNIXQ4` — 5 deposits, then a
  ZK withdrawal paid 1 XLM to a fresh address (withdraw tx
  `1940d42bdf872828a1f1ec4ecd2fce08ff9b923e35ddb0b1802892dc7a8cc33a`); a replay
  is rejected on-chain (`NullifierAlreadyUsed`).
- **Auditor view-key: working.** Encrypted `(identity, nullifier)` records are
  stored on-chain at deposit; `scripts/audit_demo.mjs` opens them with the
  view-key and traces the anonymous withdrawal to a real identity.
- **Simplifications (called out honestly):**
  - Fixed-denomination notes (variable amounts = future work via range proofs).
  - The deposit Merkle tree is maintained off-chain and its root is posted by
    the operator (`publish_root`); commitments are recorded on-chain for
    auditability. A fully on-chain incremental tree is future work and depends
    on aligning the host Poseidon parameters with circomlib's.
  - `recipient` is bound into the proof; binding it to the exact Stellar address
    bytes on-chain is a hardening step left for future work.
- **Not audited. Research prototype. Do not use with real funds.**

## Credits / prior art
Inspired by the Privacy Pools paper and Nethermind's
[stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments)
PoC. Veil's circuits and Soroban contract are written from scratch for this
hackathon, on **BN254** (Protocol 26), with a confidential-payroll product framing.

## License
MIT.
