# Season 3 recordings

Recorded September 23, 2026 against a local Canton sandbox running Veil 0.5.0.
These are recordings of actual ledger interactions, with English synthetic
narration and a caption band below the product viewport.

| Recording | Duration | What it shows |
| --- | --- | --- |
| [Main walkthrough](veil-season3-demo.mp4) | 3:00 | Reset, funded offer, acceptance, outsider visibility, stress mark, margin call, exact top-up, repayment, regulator view, and ledger evidence. |
| [Unsafe acceptance](veil-season3-unsafe-acceptance.mp4) | 1:00 | A fresh funded offer becomes unsafe after a price update; the UI disables acceptance and a direct ledger command rejects it. |

English subtitle files are available separately: [walkthrough](veil-season3-demo.srt) and
[unsafe acceptance](veil-season3-unsafe-acceptance.srt). Subtitle timing is
approximate; the shorter captions visible below the app summarize each scene.
The narration uses the macOS Samantha voice, not a team member's voice.

Both exports are 1600 × 900 H.264/AAC at 25 frames per second. Full media
decoding and Chrome load/play/seek checks passed. Every main scene and the
rejection stages were visually inspected; narration fits its scene windows.
The evidence JSON includes SHA-256 hashes of the final MP4 files.

## Reproduce and inspect

Use the [demo script](SEASON3-DEMO-SCRIPT.md) and [local runbook](RUNBOOK.md).
The main recording follows the three-minute script. For the rejection clip,
reset and create a healthy funded offer before starting the recording, publish
0.62, inspect the disabled borrower action, then attempt the same acceptance
directly through the Ledger API.

The [recording evidence](SEASON3-RECORDING-EVIDENCE.json) contains:

- Actual scene completion times and transaction update IDs/offsets.
- Cash-plus-offer reserves of 205 and free-plus-locked collateral of 200
  throughout the checked normal lifecycle stages, between issuance and reset.
- Repayment delivering 105 to the lender and returning all 200 collateral units.
- An empty outsider query, regulator/issuer settlement visibility, and no
  settlement visible to the valuer.
- The actual rejected acceptance command, HTTP 400 response, and identical
  borrower-visible active contract IDs before and after the failed command.
- No loan created by the rejected command, 100 principal still reserved,
  borrower cash still 105, and separate 150- and 50-unit collateral holdings.

The last part of the rejection clip shows a separate, read-only evidence page
generated from those captured responses. It is labeled as recording evidence
and is not part of the product UI. No application state or ledger response was
mocked for either recording. Browser actions were automated, the recordings
run at normal speed, and only the setup pre-roll was trimmed.

Implementation: [PR #39 / e25da25](https://github.com/no-witness-labs/veil-lite-hackathon/commit/e25da2561ce1c330aaf7bb6ce38e296f9e67dcba).
The checkout used for capture includes the merged team pack at
[`9855d4a`](https://github.com/no-witness-labs/veil-lite-hackathon/commit/9855d4a399162a2f115b2762e9c40f7f4b08a5ae).
The canonical local demo was reset after capture.

## Scope for the invited reviewers

Start with the recordings, then use the [audit handoff](SEASON3-AUDIT-HANDOFF.md)
to reproduce and challenge the authorization, issuer trust, valuation lineage,
time boundaries, conservation, and disclosure behavior. The handoff also invites
a better use case or new ideas for improving Veil.

The assets are simulated, prices are manually attested, and one operator controls
all roles on one participant with authentication disabled. These recordings are
internal demo evidence, not an external audit, customer trial, authenticated
multi-participant privacy test, DevNet deployment, or real asset settlement.
The earlier `veil-pitch-video.mp4` remains a pre-Season 3 artifact.
