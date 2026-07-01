# Veil 3-Minute Pitch Video Script

Target length: 2:45-3:00.

Recording target: <https://no-witness-labs.github.io/veil-lite-hackathon/>

## Pre-recording setup

1. Open the live product URL.
2. Click **Reset demo**.
3. Start on the **Lender** tab.
4. Keep the browser zoom at 90-100% so the deal card, role tabs, activity feed, and raw view are readable.
5. Keep `docs/PRESENTATION.pdf` nearby only as backup; the recording should primarily show the working app.

## Timing

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00-0:20 | App landing on Lender tab | "Institutional secured lending cannot run on a public chain if borrower identity, lender identity, deal terms, collateral, and liquidation state are visible to everyone. Veil is a Canton proof-of-concept for private repo-style financing against tokenized collateral." |
| 0:20-0:40 | Lender create form | "The lender and borrower already know each other from an off-ledger credit relationship. The lender creates a borrower-specific offer: 100 principal, 5 interest, and 150 units of tokenized T-Bill or money-market collateral." |
| 0:40-1:05 | Click **Create offer** | "This offer is not a public order book. In the Canton version it is a private Daml contract: lender is the signatory, borrower and regulator are observers, and unrelated parties cannot query it." |
| 1:05-1:25 | Switch to Borrower, click **Accept offer** | "The borrower can see the offer and accept it. Acceptance opens the loan, locks the collateral, and delivers principal to the borrower in one workflow." |
| 1:25-1:45 | Switch to Regulator | "The regulator has selective disclosure. They can observe the active loan and lifecycle state, but the UI shows they are read-only and cannot act." |
| 1:45-2:10 | Switch to Outsider, expand raw view | "This is the privacy moment. The outsider is not a stakeholder, so their active-contracts view is empty. In live Canton mode, this is enforced by stakeholder visibility, not by frontend filtering." |
| 2:10-2:30 | Switch to Borrower, click **Repay** | "The borrower repays 105, principal plus interest. The loan closes and collateral is released. The app also includes an optional liquidation branch when loan-to-value breaches the threshold." |
| 2:30-2:50 | Activity/raw/holdings panels | "The hackathon build includes Daml templates, lifecycle and privacy tests, a live Canton local mode, and a reliable hosted static demo for judges." |
| 2:50-3:00 | App footer or README/deck links | "Next steps are Token Standard integration, wallet signing, PQS indexing, and production oracle/compliance workflows. Veil shows why Canton privacy and authorization matter for real institutional credit." |

## Recording take flow

Use this exact flow for the submitted take:

1. Open <https://no-witness-labs.github.io/veil-lite-hackathon/>.
2. Click **Reset demo**.
3. Start on **Lender**.
4. Click **Create offer**.
5. Switch **Borrower** -> click **Accept offer**.
6. Switch **Regulator** -> show the read-only observer view.
7. Switch **Outsider** -> expand the raw view and show the empty `[]` result.
8. Switch **Borrower** -> click **Repay 105 USDC**.
9. Close with roadmap: Token Standard, wallet signing, PQS, and production compliance/oracle workflows.

## Click path detail

1. **Lender**: keep default terms and click **Create offer**.
2. **Borrower**: verify the offer is visible, then click **Accept offer**.
3. **Regulator**: show active loan and read-only observer badge.
4. **Outsider**: show empty state, expand the raw view, and say the live Canton mode returns `[]` for the same stakeholder-visibility reason.
5. **Borrower**: click **Repay 105 USDC**.
6. Optional if under time: mention **Simulate price drop** -> **Liquidate collateral** without clicking it.

## Phrases to avoid

- Do not say static mode is the privacy proof.
- Do not imply this is production-ready custody, oracle, wallet, or Token Standard integration.
- Do not call it an anonymous lending marketplace. This MVP is known-counterparty private credit.

## Required closing links

- Repository: <https://github.com/no-witness-labs/veil-lite-hackathon>
- Live product: <https://no-witness-labs.github.io/veil-lite-hackathon/>
- Deck: [`docs/PRESENTATION.pdf`](./PRESENTATION.pdf)
- Video: <https://no-witness-labs.github.io/veil-lite-hackathon/veil-pitch-video.mp4>
