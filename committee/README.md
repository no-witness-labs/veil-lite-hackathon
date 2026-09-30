# Veil price committee

An optional package that lets a **decentralized party** act as Veil's valuation
agent. The party is hosted on several participants and signs only when a
threshold of its members agree, using BitSafe's
[Decentralization Manager](https://github.com/DLC-link/decentralization-manager)
(DecMan). Veil's own contracts are unchanged.

| Template | What it does |
| --- | --- |
| `StreamConsent` | Lender and borrower agree to a price stream the committee will run. |
| `OpenStreamProposal` | Committee action: accept that consent, creating the stream and its first mark. |
| `PublishMarkProposal` | Committee action: move the price from the stated previous value to a new one. |

Both proposals implement DecMan's `GovernableAction`, so `GovernanceRules`
executes them only after enough members confirm, and records a
`GovernanceExecutionResult` for the audit trail. A proposal names the exact mark
it replaces, so it cannot execute after another publish.

## Build and test

```bash
dpm build                  # veil-lite, from the repository root
cd committee && dpm build
cd test && dpm build && dpm test
```

The tests run DecMan's real `GovernanceRules` with a 2-of-3 committee: one member
cannot act alone, a non-member cannot confirm, stale or misstated proposals fail,
and a committee price drop lets the lender issue a margin call on a live loan.

The DecMan DARs in `vendor/decman/` are copied unchanged; see `vendor/decman/SOURCE`.

## Run it on DecMan LocalNet

A reproducible end-to-end demo on BitSafe's LocalNet: three Canton participants,
three DecMan nodes, and a 2-of-3 decentralized party as Veil's valuation agent.
It needs Docker with 12 GB of memory and 4 CPUs.

```bash
git clone -b hackathon https://github.com/DLC-link/decentralization-manager
export DECMAN_DIR=$PWD/decentralization-manager
$DECMAN_DIR/hackathon/up.sh                                  # LocalNet + three DecMan nodes
PARTY_PREFIX=veil-price-committee $DECMAN_DIR/hackathon/seed.sh   # the committee party

dpm build && (cd committee && dpm build)                     # from this repository's root
./committee/localnet/demo.sh
```

`demo.sh` installs Veil and this package on all three participants through
DecMan's DAR distribution, then:

1. Lender and borrower consent to a committee-run T-Bill price stream.
2. The committee opens it at 1.00: node 1 proposes, nodes 1 and 2 confirm, node 3 executes.
3. The lender funds an offer priced off that mark; the borrower accepts (LTV 66.7%).
4. Node 2 proposes 0.62. After one confirmation the proposal is not executable;
   node 3 confirms, node 1 executes.
5. LTV is 107.5%, so the lender issues a margin call on the committee's price.
6. DecMan's on-chain audit trail lists every propose, confirm and execute.

Re-running `demo.sh` is safe; each run uses fresh Veil parties.
