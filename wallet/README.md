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
package, pins the package ids it read from the DAR, and signs nine borrower
transactions with that key. Before each signature it checks the whole prepared
transaction against the one it expects and prints one line saying what is
being signed (see below). At the end a plain submission as the wallet,
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
3. **Matches the whole transaction to the wallet's intent**: the transaction
   the wallet expects, which `demo.mjs` builds for each step from what it is
   doing (its contract ids, amounts and parties), never from the prepared
   transaction. The submitters must be exactly the wallet, and the tree must
   equal the intent node for node, in order, from the root down: no node more,
   none less, none different.
   - **Every exercise**, the root and every nested one (including each
     `Archive`): template and package, no interface unless named, choice,
     contract id, consuming or not, acting parties, choice observers and
     argument. So nothing is consumed that the intent does not name.
   - **Every fetch**: template and package, contract id, acting parties.
   - **Every create**: template and package, the whole argument (owner,
     amounts, quantities, parties, terms), signatories and stakeholders.
   - **Arguments compare exactly.** Every field the intent names must be
     equal (decimals by value; a field Canton drops, as it drops trailing
     `None`s, counts as `None`). A field the intent leaves out must be an
     optional set to `None`, which is what the JSON Ledger API makes of a
     command that omits it; any other unnamed field is refused, so `{}` means
     "no fields set", not "compare nothing". Records and text maps with a
     repeated label or key are refused.
   - **Packages are pinned by id.** Each node's package name must have one
     package id in the intent, and the node must use exactly that id. The demo
     reads the ids from the DAR it uploads: veil-wallet is the DAR's main
     package and veil-lite the one bundled in it (the version veil-wallet was
     compiled against); each id is recomputed as the SHA-256 of the `.dalf`
     payload and its name read from the package metadata, then checked to be
     on the participant's `/v2/packages` after the upload. Its commands name
     these ids too, so the participant has no version to choose.
   - Two values cannot be known in advance and are named as such: a contract
     created earlier in the same transaction (`{ $created: label }`, which must
     be the id that create got), and a ledger time (`{ $any: 'timestamp' }`,
     used for a mark's `observedAt` and a closed loan's `closedAt`).
   A malformed intent (a missing or unknown property, an unpinned package) is
   refused too, rather than compared loosely.
4. **Prints a summary**, for example
   `Veil:CashHolding.Split {splitAmount 30} on 00a1b2c3d4… as veil-wallet-…; archives CashHolding 00a1b2c3d4…; creates CashHolding(owner veil-wallet-…, amount 30), CashHolding(owner veil-wallet-…, amount 70)`.

`verify.mjs` has no dependencies and uses only `Uint8Array`, `DataView` and
WebCrypto (falling back to `node:crypto`), so the same file runs in a browser.
`test/wallet-verify.test.mjs` checks it against four DevNet prepare responses
(a split, a split on a disclosed contract, a create, and a create-and-exercise
with a fetch, a nested exercise and ledger time bounds) and one synthetic
transaction hashed by Canton's Python reference, which covers every Daml value
type, rollback and fetch nodes, interface ids, a non-consuming exercise and
several input contracts. Each vector verifies against its full-tree intent.
Flipping any hashed byte is refused, and so are a wrong hash, any other
hashing scheme, and an intent mismatch, including the four audited bypasses,
rebuilt with a correct hash: extra nodes under a matching root (an archive of
another contract, a create of 1000000 for an attacker), an unnamed choice
argument, another package id under the same name, and a text map with a
repeated key.

## Limits

- **Not on the HackCanton DevNet node.** Allocating an external party needs
  rights our DevNet ledger user does not have; on LocalNet we control the node.
- **What the check does not cover.** The intent is only as right as the
  wallet that writes it: the demo's expected trees follow the current
  `veil-lite` and `veil-wallet` choices, and a change to what a choice does
  makes the wallet refuse until its expectation is updated. The tree check was
  run against the DevNet vectors (which include a real `PartialRepay`), not
  yet against the demo's own steps on LocalNet; a wrong expectation there
  fails closed. Ledger times written `{ $any: 'timestamp' }` are checked to be
  timestamps, not bounded. Not compared with an expectation: exercise results
  (the values a choice returns), the signatories and stakeholders of exercised
  and fetched contracts, the type ids inside values (a record's `record_id`),
  and the input contracts, whose contents Canton authenticates. The wallet
  trusts its own DAR for the package ids, and the contract ids it acts on come
  from the ledger's earlier transactions. It does not check the synchronizer,
  command id, preparation time or ledger time bounds against its own view, only
  that they are what gets signed. An input contract's `event_blob` and the
  metadata's `max_record_time` are not part of the V2 hash, so the wallet
  neither signs nor checks them; for the event blob it relies on Canton's own
  contract authentication. Only hashing scheme V2 is implemented; V3 (contract
  keys) is refused. The key-onboarding signature (the topology `multiHash` at
  allocation) is still signed as returned.
- **Not every encoding path has a participant-made vector.** Date, variant,
  enum, text map and generic map values, rollback nodes, interface ids,
  non-consuming exercises and several input contracts are covered only by the
  synthetic vector hashed with Canton's Python reference, not by a real prepare
  response.
- The key lives in the demo process; a browser wallet would keep it as a
  non-extractable WebCrypto key.

## Recording

[`docs/veil-wallet-localnet-demo.mp4`](../docs/veil-wallet-localnet-demo.mp4)
(1:26, [YouTube](https://youtu.be/o_4EjcfgKgI), [subtitles](../docs/veil-wallet-localnet-demo.srt)) shows `demo.mjs` with
transaction verification running on a freshly reset LocalNet, with
`VEIL_DEMO_STEP=1`, which pauses before each step. Before each of the nine
signatures it prints `wallet verified:` with what the transaction does; the
wallet card shows the last verified summary. The panel shows the script's real
output; the evidence, with the full log and the MP4's SHA-256, is in
[`localnet/RECORDING-EVIDENCE.json`](localnet/RECORDING-EVIDENCE.json).
Narration is the macOS Samantha voice. It was recorded before the full-tree
check and package pinning above were added; the demo with them has not been
run on LocalNet yet.
