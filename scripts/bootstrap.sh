#!/usr/bin/env bash
# Bootstrap the running Canton sandbox for the Veil demo:
#   1. upload the Veil DAR
#   2. allocate the five demo parties (idempotent)
#   3. write frontend/public/ledger-config.json for the UI
#
# Usage: scripts/bootstrap.sh [JSON_API_URL]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-http://127.0.0.1:6864}"
DAR="$ROOT/.daml/dist/veil-lite-0.3.0.dar"
CONFIG="$ROOT/frontend/public/ledger-config.json"
USER_ID="veil"

[ -f "$DAR" ] || { echo "DAR not found at $DAR — run 'dpm build' first." >&2; exit 1; }

echo "→ Uploading DAR to $BASE"
code=000
for attempt in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v2/packages" \
    -H "Content-Type: application/octet-stream" --data-binary @"$DAR")
  [ "$code" = "200" ] && break
  echo "  upload attempt $attempt returned HTTP $code, retrying…" >&2
  sleep 2
done
[ "$code" = "200" ] || { echo "DAR upload failed (HTTP $code)" >&2; exit 1; }

existing="$(curl -s "$BASE/v2/parties")"

allocate() {
  # $1 = party hint; prints the full party id
  local hint="$1" found
  found="$(printf '%s' "$existing" | python3 -c "
import sys, json
hint = sys.argv[1]
d = json.load(sys.stdin)
for p in d.get('partyDetails', []):
    if p['party'].split('::')[0] == hint:
        print(p['party']); break
" "$hint")"
  if [ -n "$found" ]; then
    printf '%s' "$found"; return
  fi
  curl -s -X POST "$BASE/v2/parties" -H "Content-Type: application/json" \
    -d "{\"partyIdHint\":\"$hint\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['partyDetails']['party'])"
}

echo "→ Allocating parties"
LENDER="$(allocate Lender)"
BORROWER="$(allocate Borrower)"
REGULATOR="$(allocate Regulator)"
VALUER="$(allocate Valuer)"
OUTSIDER="$(allocate Outsider)"

mkdir -p "$(dirname "$CONFIG")"
cat > "$CONFIG" <<JSON
{
  "jsonApiUrl": "$BASE",
  "packageRef": "#veil-lite",
  "userId": "$USER_ID",
  "parties": {
    "lender": "$LENDER",
    "borrower": "$BORROWER",
    "regulator": "$REGULATOR",
    "valuer": "$VALUER",
    "outsider": "$OUTSIDER"
  }
}
JSON

echo "→ Wrote $CONFIG"

# Seed canonical demo holdings (kept in sync with SEED in frontend/src/ledger.ts):
# lender 100 cash, borrower 105 cash + 150 collateral and a 50-unit reserve.
# Idempotent: skip if the
# borrower already holds collateral.
COLLATERAL_ASSET="Tokenized T-Bill / MMF"

create_holding() {
  # $1 = acting party, $2 = JSON createArguments, $3 = template entity
  curl --fail-with-body -sS -o /dev/null -X POST "$BASE/v2/commands/submit-and-wait-for-transaction" \
    -H "Content-Type: application/json" \
    -d "{\"commands\":{\"commands\":[{\"CreateCommand\":{\"templateId\":\"#veil-lite:Veil:$3\",\"createArguments\":$2}}],\"commandId\":\"seed-$3-$RANDOM\",\"actAs\":[\"$1\"],\"userId\":\"$USER_ID\"}}"
}

already_seeded="$(curl -s -X POST "$BASE/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":{\"filtersByParty\":{\"$BORROWER\":{\"cumulative\":[{\"identifierFilter\":{\"WildcardFilter\":{\"value\":{\"includeCreatedEventBlob\":false}}}}]}}},\"verbose\":false,\"activeAtOffset\":$(curl -s "$BASE/v2/state/ledger-end" | python3 -c 'import sys,json;print(json.load(sys.stdin)["offset"])')}" \
  | python3 -c 'import sys,json
d=json.load(sys.stdin)
print(any("CollateralHolding" in (e.get("contractEntry",{}).get("JsActiveContract",{}).get("createdEvent",{}) or {}).get("templateId","") for e in d))')"

if [ "$already_seeded" = "True" ]; then
  echo "→ Holdings already seeded, skipping"
else
  echo "→ Seeding demo holdings"
  create_holding "$LENDER"   "{\"owner\":\"$LENDER\",\"amount\":\"100\"}"   CashHolding
  create_holding "$BORROWER" "{\"owner\":\"$BORROWER\",\"amount\":\"105\"}" CashHolding
  create_holding "$BORROWER" "{\"owner\":\"$BORROWER\",\"asset\":\"$COLLATERAL_ASSET\",\"quantity\":\"150\"}" CollateralHolding
  create_holding "$BORROWER" "{\"owner\":\"$BORROWER\",\"asset\":\"$COLLATERAL_ASSET\",\"quantity\":\"50\"}" CollateralHolding
fi

# All three demo parties authorize the stream; future price updates need only
# the valuer, through a consuming choice that preserves this stream identity.
echo "→ Checking agreed valuation stream"
mark_count="$(curl --fail-with-body -sS -X POST "$BASE/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":{\"filtersByParty\":{\"$VALUER\":{\"cumulative\":[{\"identifierFilter\":{\"WildcardFilter\":{\"value\":{\"includeCreatedEventBlob\":false}}}}]}}},\"verbose\":false,\"activeAtOffset\":$(curl --fail-with-body -sS "$BASE/v2/state/ledger-end" | python3 -c 'import sys,json;print(json.load(sys.stdin)["offset"])')}" \
  | python3 -c 'import sys,json
events=[e.get("contractEntry",{}).get("JsActiveContract",{}).get("createdEvent",{}) for e in json.load(sys.stdin)]
marks=[e for e in events if e.get("templateId", "").endswith(":Veil:CollateralValuation")]
if any("streamId" not in e["createArgument"] for e in marks):
    sys.exit("Legacy valuations found; restart with a fresh 0.3.0 sandbox.")
if any(e.get("templateId", "").endswith(":Veil:ValuationStream") for e in events):
    sys.exit("Unpublished stream found; initialize it before re-running bootstrap.")
print(len(marks))')"
if [ "$mark_count" = "0" ]; then
  curl --fail-with-body -sS -o /dev/null -X POST "$BASE/v2/commands/submit-and-wait-for-transaction" \
    -H "Content-Type: application/json" \
    -d "{\"commands\":{\"commands\":[{\"CreateAndExerciseCommand\":{\"templateId\":\"#veil-lite:Veil:ValuationStream\",\"createArguments\":{\"valuationAgent\":\"$VALUER\",\"lender\":\"$LENDER\",\"borrower\":\"$BORROWER\",\"regulator\":\"$REGULATOR\",\"collateralAsset\":\"$COLLATERAL_ASSET\"},\"choice\":\"PublishInitial\",\"choiceArgument\":{\"unitPrice\":\"1\"}}}],\"commandId\":\"seed-valuation-$RANDOM\",\"actAs\":[\"$LENDER\",\"$BORROWER\",\"$VALUER\"],\"userId\":\"$USER_ID\"}}"
elif [ "$mark_count" != "1" ]; then
  echo "Ambiguous valuation streams; use a fresh sandbox." >&2
  exit 1
fi

echo "✓ Bootstrap complete"
