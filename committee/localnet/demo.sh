#!/bin/bash
# Veil price committee on BitSafe's DecMan LocalNet.
#
# A 2-of-3 decentralized party is Veil's valuation agent. It opens a price
# stream the lender and borrower agreed to, a loan is priced off it, the
# committee drops the price, and the lender issues a margin call. Every
# committee action is proposed on one node, confirmed on a second and executed
# on a third.
#
# Prerequisites: a DecMan checkout (DECMAN_DIR, branch `hackathon`) with
# hackathon/up.sh and hackathon/seed.sh already run, and the two DARs built:
#   dpm build && (cd committee && dpm build)
set -euo pipefail

VEIL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DECMAN_DIR="${DECMAN_DIR:?set DECMAN_DIR to your decentralization-manager checkout}"
. "$DECMAN_DIR/hackathon/lib.sh"

VEIL_DARS="$VEIL_DIR/.daml/dist/veil-lite-0.9.0.dar
$VEIL_DIR/committee/.daml/dist/veil-price-committee-0.1.0.dar"
TBILL="Tokenized T-Bill / MMF"
USER_ID=ledger-api-user
P1=3975 # JSON Ledger API of participant 1 (app-provider); the Veil app parties live here
RUN=$(date +%s) # party hints are unique per run, so the demo can be re-run
PLACEHOLDER_ACTION='{"type": "governance_set_threshold", "new_threshold": 0}'

load_state
DEC_PARTY_ID="${DEC_PARTY_ID-}"
RULES_CID="${RULES_CID-}"
[ -n "$DEC_PARTY_ID" ] && [ -n "$RULES_CID" ] || die "run hackathon/seed.sh in $DECMAN_DIR first"

ledger_get() { req GET "http://localhost:$1$2" "" "$LOCALNET_CANTON_TOKEN"; }

# Submit one command as the given parties on a participant and return the transaction.
submit() {
    local port=$1 act_as=$2 read_as=$3 command=$4
    canton_post "$port" /v2/commands/submit-and-wait-for-transaction "$(jq -n \
        --argjson actAs "$act_as" --argjson readAs "$read_as" --argjson command "$command" \
        --arg userId "$USER_ID" --arg commandId "veil-committee-$(date +%s%N)-$RANDOM" \
        '{commands: {commands: [$command], commandId: $commandId, userId: $userId, actAs: $actAs, readAs: $readAs}}')"
}

# Contract id of the first event created from a template (by entity name).
created() {
    jq -r --arg t "$1" 'first(.transaction.events[]? | .CreatedEvent? // empty
        | select(.templateId | endswith(":" + $t)) | .contractId) // empty'
}

allocate() {
    local hint=$1 party
    party=$(canton_post "$P1" /v2/parties "$(jq -n --arg hint "$hint" \
        '{partyIdHint: $hint, identityProviderId: "", localMetadata: {annotations: {}}}')" | jq -r '.partyDetails.party')
    [ -n "$party" ] && [ "$party" != "null" ] || die "could not allocate $hint"
    canton_post "$P1" "/v2/users/$USER_ID/rights" "$(jq -n --arg p "$party" --arg u "$USER_ID" \
        '{userId: $u, identityProviderId: "", rights: [{kind: {CanActAs: {value: {party: $p}}}}, {kind: {CanReadAs: {value: {party: $p}}}}]}')" >/dev/null
    printf '%s' "$party"
}

distribute_veil_dars() {
    if [ -n "${VEIL_DARS_DONE-}" ]; then
        info "the Veil DARs are already on all three participants"
        return 0
    fi
    say "Distributing the Veil DARs to all three participants"
    local tmp path pid2 pid3
    tmp=$(mktemp -d)
    : > "$tmp/entries.json"
    while IFS= read -r path; do
        [ -f "$path" ] || die "missing $path: build it first"
        base64 < "$path" | tr -d '\n' > "$tmp/b64"
        jq -n --arg filename "$(basename "$path")" --rawfile data "$tmp/b64" '{filename: $filename, data: $data}' >> "$tmp/entries.json"
    done <<< "$VEIL_DARS"
    pid2=$(dm_get 8082 /node-config | jq -r '.node.participant_id')
    pid3=$(dm_get 8083 /node-config | jq -r '.node.participant_id')
    jq -s --arg p2 "$pid2" --arg p3 "$pid3" '{dar_files: ., peer_ids: [$p2, $p3]}' "$tmp/entries.json" > "$tmp/payload.json"
    dm_post 8081 /dars/distribute "@$tmp/payload.json" >/dev/null
    rm -rf "$tmp"
    accept_invitation 2 Dars
    accept_invitation 3 Dars
    poll_workflow 8081 /dars/distribute/status "the Veil DAR distribution"
    state_set VEIL_DARS_DONE 1
}

# Wait until a node lists the proposal, confirm it there.
confirm_on() {
    local idx=$1 cid=$2 port attempt=0
    port=$(http_port "$idx")
    until try_get "$port" "/governance/confirmations?party_id=$DEC_PARTY_ID" \
        | jq -e --arg cid "$cid" 'any(.domain_actions[]?; .proposal_cid == $cid)' >/dev/null; do
        attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || die "$(node_name "$idx") never saw proposal $cid"; sleep 2
    done
    dm_post "$port" /governance/confirm "$(jq -n --arg party "$DEC_PARTY_ID" --arg rules "$RULES_CID" \
        --arg cid "$cid" --argjson action "$PLACEHOLDER_ACTION" \
        '{party_id: $party, rules_contract_id: $rules, action: $action, governance_type: "core_domain", proposal_cid: $cid}')" >/dev/null
    info "$(node_name "$idx") confirmed"
}

execute_on() {
    local idx=$1 cid=$2 port attempt=0 confirmations=""
    port=$(http_port "$idx")
    while [ -z "$confirmations" ] || [ "$confirmations" = "null" ]; do
        attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || die "proposal $cid never became executable on $(node_name "$idx")"
        confirmations=$(try_get "$port" "/governance/confirmations?party_id=$DEC_PARTY_ID" | jq -c --arg cid "$cid" \
            'first(.domain_actions[]? | select(.proposal_cid == $cid and .can_execute)) | [.confirmations[]?.contract_id] // empty' || true)
        [ -n "$confirmations" ] || sleep 2
    done
    dm_post "$port" /governance/execute "$(jq -n --arg party "$DEC_PARTY_ID" --arg rules "$RULES_CID" \
        --arg cid "$cid" --argjson action "$PLACEHOLDER_ACTION" --argjson confirmations "$confirmations" \
        '{party_id: $party, rules_contract_id: $rules, action: $action, confirmation_cids: $confirmations,
          disclosed_contracts: [], governance_type: "core_domain", proposal_cid: $cid}')" >/dev/null
    info "$(node_name "$idx") executed with confirmations $confirmations"
}

# The single current price mark the lender sees on the committee's stream.
current_mark() {
    local end
    end=$(ledger_get "$P1" /v2/state/ledger-end | jq -r '.offset')
    canton_post "$P1" /v2/state/active-contracts "$(jq -n --arg p "$LENDER" --argjson end "$end" \
        '{filter: {filtersByParty: {($p): {cumulative: [{identifierFilter: {TemplateFilter: {value: {templateId: "#veil-lite:Veil:CollateralValuation", includeCreatedEventBlob: false}}}}]}}}, verbose: false, activeAtOffset: $end}')" \
        | jq -c --arg dec "$DEC_PARTY_ID" '[.[].contractEntry.JsActiveContract.createdEvent | select(.createArgument.valuationAgent == $dec) | {cid: .contractId, price: .createArgument.unitPrice}] | last'
}

require_stack_up
distribute_veil_dars

say "Allocating the Veil parties on participant 1"
ISSUER=$(allocate "veil-issuer-$RUN")
LENDER=$(allocate "veil-lender-$RUN")
BORROWER=$(allocate "veil-borrower-$RUN")
REGULATOR=$(allocate "veil-regulator-$RUN")
MEMBER_1="${MEMBER_1:?}"; MEMBER_2="${MEMBER_2:?}"
info "valuation agent (committee) $DEC_PARTY_ID"
info "lender $LENDER"
info "borrower $BORROWER"

say "Lender and borrower consent to a committee-run T-Bill price stream at 1.00"
CONSENT=$(submit "$P1" "[\"$LENDER\",\"$BORROWER\"]" '[]' "$(jq -n --arg v "$DEC_PARTY_ID" --arg l "$LENDER" --arg b "$BORROWER" --arg r "$REGULATOR" --arg a "$TBILL" \
    '{CreateCommand: {templateId: "#veil-price-committee:Veil.Committee.Price:StreamConsent", createArguments: {valuationAgent: $v, lender: $l, borrower: $b, regulator: $r, collateralAsset: $a, initialPrice: "1.0"}}}')" | created StreamConsent)
info "consent $CONSENT"

say "Committee: node 1 proposes opening the stream"
OPEN=$(submit "$P1" "[\"$MEMBER_1\"]" '[]' "$(jq -n --arg g "$DEC_PARTY_ID" --arg m "$MEMBER_1" --arg c "$CONSENT" --arg a "$TBILL" \
    '{CreateCommand: {templateId: "#veil-price-committee:Veil.Committee.Price:OpenStreamProposal", createArguments: {governanceParty: $g, proposer: $m, consentCid: $c, collateralAsset: $a, initialPrice: "1.0"}}}')" | created OpenStreamProposal)
confirm_on 1 "$OPEN"
confirm_on 2 "$OPEN"
execute_on 3 "$OPEN"
MARK=$(current_mark); info "price mark $MARK"
MARK_CID=$(printf '%s' "$MARK" | jq -r '.cid')

say "Lender funds an offer priced off the committee's mark; the borrower accepts"
CASH=$(submit "$P1" "[\"$ISSUER\",\"$LENDER\"]" '[]' "$(jq -n --arg i "$ISSUER" --arg o "$LENDER" \
    '{CreateCommand: {templateId: "#veil-lite:Veil:CashHolding", createArguments: {issuer: $i, owner: $o, amount: "100.0"}}}')" | created CashHolding)
COLLATERAL=$(submit "$P1" "[\"$ISSUER\",\"$BORROWER\"]" '[]' "$(jq -n --arg i "$ISSUER" --arg o "$BORROWER" --arg a "$TBILL" \
    '{CreateCommand: {templateId: "#veil-lite:Veil:CollateralHolding", createArguments: {issuer: $i, owner: $o, asset: $a, quantity: "150.0"}}}')" | created CollateralHolding)
MATURITY=$(date -u -v+30d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '+30 days' +%Y-%m-%dT00:00:00Z)
OFFER=$(submit "$P1" "[\"$LENDER\"]" '[]' "$(jq -n --arg c "$CASH" --arg b "$BORROWER" --arg r "$REGULATOR" --arg v "$DEC_PARTY_ID" --arg m "$MARK_CID" --arg a "$TBILL" --arg mat "$MATURITY" \
    '{ExerciseCommand: {templateId: "#veil-lite:Veil:CashHolding", contractId: $c, choice: "MakeOffer", choiceArgument: {
        borrower: $b, regulator: $r, valuationAgent: $v, valuationCid: $m, principal: "100.0", interest: "5.0",
        collateralAsset: $a, collateralQuantity: "150.0", maturity: $mat, liquidationThresholdLtv: "90.0",
        marginCallWindowSeconds: "60", expiresAt: null}}}')" | created LoanOffer)
LOAN=$(submit "$P1" "[\"$BORROWER\"]" '[]' "$(jq -n --arg o "$OFFER" --arg c "$COLLATERAL" --arg m "$MARK_CID" \
    '{ExerciseCommand: {templateId: "#veil-lite:Veil:LoanOffer", contractId: $o, choice: "Accept", choiceArgument: {collateralCid: $c, valuationCid: $m}}}')" | created Loan)
info "loan $LOAN: 100 against 150 T-Bill units at 1.00 (LTV 66.7%)"

say "Committee: node 2 proposes dropping the price to 0.62"
DROP=$(submit 2975 "[\"$MEMBER_2\"]" '[]' "$(jq -n --arg g "$DEC_PARTY_ID" --arg m "$MEMBER_2" --arg c "$MARK_CID" --arg a "$TBILL" \
    '{CreateCommand: {templateId: "#veil-price-committee:Veil.Committee.Price:PublishMarkProposal", createArguments: {governanceParty: $g, proposer: $m, markCid: $c, collateralAsset: $a, previousPrice: "1.0", newPrice: "0.62"}}}')" | created PublishMarkProposal)
confirm_on 2 "$DROP"
sleep 3
ONE=$(try_get 8081 "/governance/confirmations?party_id=$DEC_PARTY_ID" | jq -r --arg cid "$DROP" 'first(.domain_actions[]? | select(.proposal_cid == $cid) | .can_execute) // false')
info "after one confirmation, executable: $ONE"
[ "$ONE" = "false" ] || die "one confirmation must not be enough"
confirm_on 3 "$DROP"
execute_on 1 "$DROP"
STRESSED=$(current_mark); info "price mark $STRESSED"

say "LTV is now 107.5%: the lender issues a margin call on the committee's price"
CALLED=$(submit "$P1" "[\"$LENDER\"]" '[]' "$(jq -n --arg l "$LOAN" --arg m "$(printf '%s' "$STRESSED" | jq -r '.cid')" \
    '{ExerciseCommand: {templateId: "#veil-lite:Veil:Loan", contractId: $l, choice: "IssueMarginCall", choiceArgument: {valuationCid: $m}}}')")
printf '%s' "$CALLED" | jq '[.transaction.events[]?.CreatedEvent? // empty | select(.templateId | endswith(":Loan")) | .createArgument.marginCall]'

say "Committee audit trail (node 1)"
dm_get 8081 "/governance/chain-audit?party_id=$DEC_PARTY_ID&limit=20&refresh=true" \
    | jq '[.entries[]? | {event_type, timestamp, acting_parties, contract_id}]'
