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
