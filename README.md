# Veil: a Compliant Privacy Pool for USDC on Stellar

> Private payouts that carry their own proof of compliance.
> Zero-knowledge withdrawals verified **on-chain** by a Soroban contract using
> the brand-new **Protocol 26 BN254 pairing** host function.

**Origin:** built for Stellar Hacks: Real-World ZK (SDF / DoraHacks), then
hardened in response to SDF's review. See [Security](#security-what-was-broken-and-what-fixed-it).

### Live on Stellar testnet

- **Contract:** `CCXOIBSGTXVYDWY6RBLVAVNYERHGLKAE4UCU73CEBXGUUNP622WHHWLI`
- **5 deposits, then a ZK withdrawal that paid 1 XLM privately** to a fresh
  address:
  [withdraw tx 1cb5e2ac…](https://stellar.expert/explorer/testnet/tx/1cb5e2ac9eb87225977fe6552b14bf32936a55767116b4a7e6c384bcad4794cb)
- **The Merkle tree is maintained on-chain.** `leaf_count` → `5` and `root` →
  `1ea97922…` were derived by the contract itself as deposits landed. There is
  no `publish_root`; nobody, including the admin, can name a root over notes
  that were never paid for.
- **Redirecting a valid proof is rejected on-chain**, `Error #9`
  (`RecipientMismatch`). **Replaying one is rejected**, `Error #4`
  (`NullifierAlreadyUsed`).
- A **real** Circom/snarkjs Groth16 proof, verified by Stellar's Protocol 26
  **BN254 `pairing_check`** host function, inside the deployed contract.
- **Auditor view-key**: every deposit publishes an on-chain encrypted record that
  only a designated regulator can open. Privacy for the public, full
  auditability for the regulator (`node scripts/audit_demo.mjs`).

**Check it yourself in a browser, no wallet and no setup:**
[veil-zk.vercel.app/console.html](https://veil-zk.vercel.app/console.html).
Four buttons, each one a real call to the deployed contract: read the
contract-derived tree, verify a Groth16 proof on-chain, try to redirect the
payout, try to spend the note twice.

Or from a terminal: `bash scripts/show.sh` (~15s). **12 tests pass**
(`cd contracts/veil && cargo test`), including a full deposit → on-chain-root →
withdraw cycle and five attack cases.

---

## TL;DR: what it is and why it's different

A **privacy pool** lets you deposit funds and later withdraw to a *fresh,
unlinkable* address, so on-chain nobody can connect your payout to your deposit.
The problem with naive pools (mixers) is that they're indistinguishable from
money laundering, so institutions won't touch them.

**Veil** fixes that the way the [Privacy Pools paper](https://privacypools.com/whitepaper.pdf)
(Buterin, Illum, Nadler, Schär, Soleimani) proposes: every withdrawal proves, in
zero knowledge, that the note also belongs to an **approved association set**
curated by an Association Set Provider (ASP). So you get **privacy for honest
users and exclusion of bad actors at the same time**, the "compliant privacy"
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
   (`associationRoot`), the compliance gate.
4. The revealed `nullifierHash = Poseidon(nullifier)` matches the note, so it can
   be spent **only once** (anti-double-spend).
5. The payout addresses and the relayer fee are bound into the proof, so a valid
   proof authorises exactly one payment to exactly one payee.

Public inputs (in order):
`[root, associationRoot, nullifierHash, recipientHi, recipientLo, relayerHi, relayerLo, fee]`.

A Stellar address is a 32-byte payload plus a type discriminant, which does not
fit in one 254-bit field element, so each address is carried as two limbs
(`Hi` = type byte + first 16 payload bytes, `Lo` = the remaining 16). The
contract re-derives both from the address it is about to pay and compares them
byte for byte. The split is injective and involves no hashing, so there is no
collision assumption anywhere in the binding.

> Poseidon is used deliberately. It's ZK-friendly **and** a native Stellar host
> function, so the same primitive lives on both sides. The contract hashes
> Merkle nodes with `poseidon_permutation` fed circomlib's own BN254 parameters,
> and `poseidon_matches_circomlib` checks the result against vectors produced by
> circomlibjs rather than assuming the two agree.

---

## Auditor view-key: privacy *and* auditability

A naive privacy pool is opaque even to a legitimate regulator. Veil adds a
**selective-disclosure** layer: a designated auditor holds a **BabyJubJub**
keypair, and at deposit time the depositor encrypts an audit record,
`(identity, nullifier)`, to the auditor's public key and **publishes the
ciphertext on-chain**. So the regulator's ability to investigate never depends
on a depositor voluntarily keeping records.

- **The public** sees only ciphertext; withdrawals stay unlinkable.
- **The auditor**, with the view-key, decrypts any record and, by hashing the
  recovered nullifier to the same `nullifierHash` the withdrawal reveals, traces
  an anonymous payout back to a real identity.

The scheme is ElGamal-style hybrid encryption with a Poseidon stream cipher over
BabyJubJub (the embedded curve of BN254), so every value lives in the same field
as the circuit signals, which means the correctness of an audit record can be
enforced *inside the circuit* as a natural next step. See `scripts/lib/audit.mjs`
and run the live demo with `node scripts/audit_demo.mjs`.

---

## How Stellar verifies it (the load-bearing part)

`contracts/veil` is a Soroban contract that verifies the proof on-chain with the
**Protocol 26 BN254 host functions**, `env.crypto().bn254()`:

```
Groth16 check  ==  e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1
                   vk_x = IC₀ + Σ publicᵢ · ICᵢ₊₁
```

implemented as one `bn254().pairing_check(g1_vec, g2_vec)` call, with `vk_x`
accumulated via `bn254().g1_mul` / `g1_add`. We chose **BN254** (not the older
BLS12-381 examples) precisely because Protocol 26's new BN254 pairing is what
this hackathon was created to exercise, and it's Ethereum-precompile-compatible.

The contract also implements the pool:
`init` · `deposit` · `set_association_root` · `withdraw` · `verify_proof` ·
`root` · `roots` · `leaf_count` · `auditor` · `audit_records` · `commitments`.

`deposit` takes payment, appends the commitment to the contract's own Merkle
tree, derives the new root, and stores the encrypted auditor record on-chain.

`withdraw` requires every public input to be a canonical field element, checks
the root is one **this contract derived**, that the association root matches the
ASP, that the nullifier is unused, that the named recipient and relayer are
exactly the ones the proof commits to, and that the fee leaves something for the
recipient, then verifies the proof and pays out.

---

## Security: what was broken, and what fixed it

SDF reviewed the original submission and flagged two gaps. Closing them properly
surfaced two further vulnerabilities that were not in the review. All four are
fixed, and each has a regression test that fails against the old behaviour.

**1. Redirectable withdrawals (critical, fund theft).** The circuit committed to
a recipient, but the contract never compared that commitment to the address it
actually paid. Anyone watching the network could lift a pending withdrawal's
proof and public inputs *verbatim*, resubmit them naming their own address, and
be paid. The proof still verified, because nothing it committed to had changed.
Fixed by deriving the payee's limbs from the `Address` and comparing
(`src/address_bind.rs`). Tests: `withdraw_rejects_a_substituted_recipient`,
`withdraw_rejects_a_substituted_relayer`.

**2. Double-spend via non-canonical encoding (critical).** Field elements arrive
as 32 raw bytes, and the host silently reduces anything oversized mod `p`, but
spent notes were keyed on those raw bytes. So `n` and `n + p` are the same input
to the proof system and different keys to storage. Roughly five encodings of any
field element fit below 2²⁵⁶, so one note could be withdrawn about five times
using the *same* proof. Fixed by rejecting any input at or above the modulus
before anything is compared or stored (`src/field.rs`). Tests:
`rejects_non_canonical_public_input`, `withdraw_rejects_a_replayed_note`.

**3. Operator-trusted root.** The deposits root was computed off-chain and posted
by the operator, who could therefore publish a root over commitments nobody had
deposited against and withdraw real funds with a valid proof. The ZK was sound;
its input was not. Fixed by building the tree in the contract
(`src/merkle.rs`) and deleting `publish_root`. Tests:
`merkle_tree_matches_prover`, `withdraw_rejects_an_unknown_root`.

**4. Unenforced fee.** `fee` was a circuit public input the contract ignored.
It is now paid to a relayer whose address is bound like the recipient's, which
also makes the pool usable: a genuinely fresh recipient holds no XLM and cannot
pay for its own withdrawal.

The on-chain tree is only possible because Soroban's `poseidon_permutation` host
function is fully parameterized. Feeding it circomlib's own BN254 constants
reproduces circomlib's `Poseidon(2)` exactly, so the contract and the circuit
agree on every Merkle node. One deposit costs **21.3M CPU instructions** against
a 100M per-transaction limit, measured by `deposit_fits_in_transaction_budget`.

---

## Repository layout

```
circuits/
  withdraw.circom      # the ZK circuit (dual Merkle membership + nullifier)
  merkle.circom        # Poseidon Merkle proof gadget
contracts/veil/
  src/lib.rs           # Soroban BN254 Groth16 verifier + privacy pool
  src/merkle.rs        # on-chain incremental Merkle tree (replaces publish_root)
  src/poseidon.rs      # circomlib-compatible Poseidon over the host permutation
  src/poseidon_params.rs # generated circomlib constants + test vectors
  src/address_bind.rs  # exact address <-> field-limb binding
  src/field.rs         # canonical field-element validation
  src/test.rs          # 12 tests: real proof, real tree, four attack cases
  src/fixture.rs       # auto-generated real-proof bytes (by 05_export.mjs)
scripts/
  01_compile.mjs       # circom -> r1cs + wasm
  02_setup.mjs         # Powers of Tau + Groth16 trusted setup
  03_prove.mjs         # generate a real withdrawal proof
  04_verify.mjs        # verify it + confirm a tampered payee fails
  05_export.mjs        # snarkjs JSON -> Soroban byte layout (EIP-197) + fixture
  demo.mjs             # full off-chain story (deposit -> private withdraw)
  onchain_demo.mjs     # prepare a real testnet deposit->withdraw (+ audit records)
  audit_demo.mjs       # auditor opens on-chain records, traces a withdrawal
  show.sh              # one-command live demo against the deployed contract
  gen_poseidon_params.mjs  # emit circomlib constants into the contract
  lib/veil.mjs         # Poseidon + Merkle + strkey helpers (match the circuit)
  lib/scenario.mjs     # the shared pool scenario used by prove/verify/demo
  lib/audit.mjs        # auditor view-key (Poseidon-ElGamal over BabyJubJub)
  deploy/testnet_demo.sh   # one-shot live testnet deposit->withdraw demo
bin/circom.exe         # circom 2.1.9 compiler
```

## Run it

**Prerequisites:** Node.js 20+, and, for the contract tests only, a Rust
toolchain. The circom 2.1.9 compiler is downloaded automatically on first
`npm run compile` (Windows, Linux and macOS x86-64); an existing `circom` of
that version on `PATH` is used instead if present. The Stellar CLI (27.x) is
only needed for the live testnet steps.

Nothing below needs an API key or an account.

```bash
npm install
npm run compile          # compile the circuit (10,178 constraints, 8 public inputs)
npm run setup            # trusted setup (downloads Powers of Tau, ~1 min)
npm run prove            # generate a REAL Groth16 withdrawal proof
npm run verify           # verify it, and confirm a tampered payee is rejected
npm run demo             # the same thing as a narrated end-to-end story

# Regenerate the Soroban byte layout + the Rust test fixture from that proof:
node scripts/05_export.mjs

# On-chain verification in the real Soroban host: 12 tests, including a full
# deposit -> contract-derived root -> withdraw cycle and four attack cases.
cd contracts/veil && cargo test
```

Against the live testnet contract:

```bash
bash scripts/show.sh          # ~15s: live root, real payout, both attacks rejected
node scripts/audit_demo.mjs   # regulator traces the anonymous withdrawal
```

To redeploy your own instance end to end:

```bash
RECIPIENT=<G...address> node scripts/onchain_demo.mjs
node scripts/05_export.mjs && node scripts/deploy/cli_args.mjs
bash scripts/deploy/testnet_demo.sh
```

---

## Status: honest notes

- **ZK proving: working.** `npm run prove` generates a real Groth16 proof;
  `npm run verify` checks it and confirms a tampered payee is rejected.
  `npm run demo` also shows that a non-approved note cannot produce a compliant
  proof at all.
- **On-chain verification and the pool: LIVE on testnet.** Contract
  `CCXOIBSGTXVYDWY6RBLVAVNYERHGLKAE4UCU73CEBXGUUNP622WHHWLI`. 5 deposits, the
  root derived on-chain, then a ZK withdrawal paid 1 XLM to a fresh address
  (withdraw tx `1cb5e2ac9eb87225977fe6552b14bf32936a55767116b4a7e6c384bcad4794cb`).
  Redirect rejected (`Error #9`), replay rejected (`Error #4`). Reproducible
  offline via `cargo test`.
- **On-chain Merkle tree: working.** The root is derived by the contract, not
  posted by an operator.
- **Auditor view-key: working.** Encrypted `(identity, nullifier)` records are
  stored on-chain at deposit; `scripts/audit_demo.mjs` opens them with the
  view-key and traces the anonymous withdrawal to a real identity.
- **What is still simplified:**
  - Fixed-denomination notes. Variable amounts need range proofs.
  - Audit-record correctness is trusted at deposit time: a depositor could
    publish a record that does not describe their note. The ElGamal design is
    field-aligned specifically so this can be constrained inside the circuit,
    which is the next substantial piece of work.
  - The association set is curated by a single ASP key, which is by design:
    the compliance authority is a trusted party in this model. But it is a
    centralisation point worth naming.
  - The trusted setup is a single-contributor ceremony. A real deployment needs
    a multi-party one.
- **Not audited. Research prototype. Do not use with real funds.**

## Credits / prior art
Inspired by the Privacy Pools paper and Nethermind's
[stellar-private-payments](https://github.com/NethermindEth/stellar-private-payments)
PoC. Veil's circuits and Soroban contract are written from scratch for this
hackathon, on **BN254** (Protocol 26), with a confidential-payroll product framing.

## License
MIT.
