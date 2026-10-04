# Veil wallet: self-custody borrowers

An optional package that lets the borrower be an **external party**: a Canton
party whose Ed25519 key stays with the user (in a browser, it would never leave
the page). The participant prepares each transaction, the wallet signs its hash,
and the participant executes it. Without the key, the participant cannot act for
the wallet at all.

Canton requires every party acting in such a transaction to sign it externally,
so the wallet always acts alone. Veil's loan steps (accept, pay down, top up,
repay) already need only the borrower. The steps Veil does jointly with the
borrower become an offer by the other side and an accept by the wallet:

| Template | Offered by | The wallet accepts to get |
| --- | --- | --- |
| `CashGrant` | issuer | a `CashHolding` |
| `CollateralGrant` | issuer | a `CollateralHolding` |
| `StreamInvite` | lender and valuation agent | a `ValuationStream` and its first mark |

Veil's own contracts are unchanged.

## Build and test

```bash
dpm build                 # veil-lite, from the repository root
cd wallet && dpm build
cd test && dpm build && dpm test
node --test test/wallet-verify.test.mjs   # from the repository root: the signing checks
```

The tests run a whole loan with the wallet only ever submitting alone:
onboarding, acceptance, a margin call cured by a 30 pay-down, and repayment with
the collateral returned. Only the wallet can accept its grants and invites.

## Run it on LocalNet

With a LocalNet whose participant 1 JSON Ledger API is on port 3975 and
authentication is off (for example BitSafe DecMan's hackathon LocalNet, see
`committee/README.md`):

```bash
dpm build && (cd wallet && dpm build)
CANTON_TOKEN=<LocalNet ledger API token> node wallet/localnet/demo.mjs
```

It creates a key, allocates the wallet as an external party, installs this
package, and signs nine borrower transactions with that key. Before each
signature it checks the prepared transaction and prints one line saying what
is being signed (see below). At the end a plain submission as the wallet,
without a signature, is refused.

## What the wallet checks before it signs

For each step the participant returns the prepared transaction (a protobuf
`PreparedTransaction`) and a hash to sign. [`localnet/verify.mjs`](localnet/verify.mjs)
does not trust that hash. Before signing, it:

1. **Decodes the protobuf** with a strict decoder for just these messages. It
   refuses unknown fields, a field given twice, two members of one oneof, wrong
   wire types, invalid UTF-8 and truncated input, so the wallet and the
   participant cannot read different transactions from the same bytes.
2. **Recomputes the hash** with hashing scheme V2, following Canton's
   reference implementation byte for byte: every node of the tree, node seeds,
   the submitters, command id, transaction UUID, mediator group, synchronizer,
   ledger time bounds, preparation time and every input contract. It refuses
   any scheme other than V2, a returned hash that differs, and any structure V2
   would not hash: contract keys, QueryByKey nodes, nodes no root reaches, nodes
   reached twice, and duplicate node ids or seeds. The wallet signs the hash it
   computed itself.
3. **Matches the transaction to the wallet's intent**, the command the wallet
   itself built. The submitters must be exactly the wallet. The transaction
   must have one root action, and it must be that choice (package name, module
   and template, not through an interface) on that contract id, acting only as
   the wallet, with every argument equal to the command's (decimals compare by
   value).
4. **Prints a summary**, for example
   `Veil:CashHolding.Split {splitAmount 30} on 00a1b2c3d4… as veil-wallet-…; archives CashHolding 00a1b2c3d4…; creates CashHolding(owner veil-wallet-…, amount 30), CashHolding(owner veil-wallet-…, amount 70)`.

`verify.mjs` has no dependencies and uses only `Uint8Array`, `DataView` and
WebCrypto (falling back to `node:crypto`), so the same file runs in a browser.
`test/wallet-verify.test.mjs` checks it against four DevNet prepare responses
(a split, a split on a disclosed contract, a create, and a create-and-exercise
with a fetch, a nested exercise and ledger time bounds) and one synthetic
transaction hashed by Canton's Python reference, which covers every Daml value
type, rollback and fetch nodes, interface ids, a non-consuming exercise and
several input contracts. Flipping any hashed byte is refused, and so are a
wrong hash, any other hashing scheme, and an intent mismatch.

## Limits

- **Not on the HackCanton DevNet node.** Allocating an external party needs
  rights our DevNet ledger user does not have; on LocalNet we control the node.
- **What the check does not cover.** The wallet checks the root action against
  its intent, but not what that choice does further down the tree: the nested
  creates, archives, fetches and exercises are hashed and shown in the summary,
  not compared with an expected outcome. It pins the package by name, not by
  package id, so it accepts any vetted version of `veil-lite` or `veil-wallet`.
  It does not check the synchronizer, command id, preparation time or ledger
  time bounds against its own view, only that they are what gets signed. An
  input contract's `event_blob` and the metadata's `max_record_time` are not
  part of the V2 hash, so the wallet neither signs nor checks them; for the
  event blob it relies on Canton's own contract authentication. Only hashing scheme V2 is
  implemented; V3 (contract keys) is refused. The key-onboarding signature (the
  topology `multiHash` at allocation) is still signed as returned.
- **Not every encoding path has a participant-made vector.** Date, variant,
  enum, text map and generic map values, rollback nodes, interface ids,
  non-consuming exercises and several input contracts are covered only by the
  synthetic vector hashed with Canton's Python reference, not by a real prepare
  response.
- The key lives in the demo process; a browser wallet would keep it as a
  non-extractable WebCrypto key.

## Recording

[`docs/veil-wallet-localnet-demo.mp4`](../docs/veil-wallet-localnet-demo.mp4)
(1:26, [subtitles](../docs/veil-wallet-localnet-demo.srt)) shows `demo.mjs` with
transaction verification running on a freshly reset LocalNet, with
`VEIL_DEMO_STEP=1`, which pauses before each step. Before each of the nine
signatures it prints `wallet verified:` with what the transaction does; the
wallet card shows the last verified summary. The panel shows the script's real
output; the evidence, with the full log and the MP4's SHA-256, is in
[`localnet/RECORDING-EVIDENCE.json`](localnet/RECORDING-EVIDENCE.json).
Narration is the macOS Samantha voice.
