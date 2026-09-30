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
package, and signs nine borrower transactions with that key. At the end a plain
submission as the wallet, without a signature, is refused.

## Limits

- **Not on the HackCanton DevNet node.** Allocating an external party needs
  rights our DevNet ledger user does not have; on LocalNet we control the node.
- **The wallet signs the hash the participant returns.** A production wallet must
  decode the prepared transaction, show what it does, and recompute the hash
  before signing, so a dishonest participant cannot get a different transaction
  signed. This demo does not do that yet.
- The key lives in the demo process; a browser wallet would keep it as a
  non-extractable WebCrypto key.
