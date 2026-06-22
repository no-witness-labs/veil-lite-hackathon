#!/usr/bin/env bash
# Bootstrap the running Canton sandbox for the Veil demo:
#   1. upload the Veil DAR
#   2. allocate the four demo parties (idempotent)
#   3. write frontend/src/ledger-config.json for the UI
#
# Usage: scripts/bootstrap.sh [JSON_API_URL]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-http://127.0.0.1:6864}"
DAR="$ROOT/.daml/dist/veil-0.1.0.dar"
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
OUTSIDER="$(allocate Outsider)"

mkdir -p "$(dirname "$CONFIG")"
cat > "$CONFIG" <<JSON
{
  "jsonApiUrl": "$BASE",
  "packageRef": "#veil",
  "userId": "$USER_ID",
  "parties": {
    "lender": "$LENDER",
    "borrower": "$BORROWER",
    "regulator": "$REGULATOR",
    "outsider": "$OUTSIDER"
  }
}
JSON

echo "→ Wrote $CONFIG"

# Seed canonical demo holdings (kept in sync with SEED in frontend/src/ledger.ts):
# lender 100 cash, borrower 105 cash + 150 collateral. Idempotent: skip if the
# borrower already holds collateral.
COLLATERAL_ASSET="Tokenized T-Bill / MMF"

create_holding() {
  # $1 = acting party, $2 = JSON createArguments, $3 = template entity
  curl -s -o /dev/null -X POST "$BASE/v2/commands/submit-and-wait-for-transaction" \
    -H "Content-Type: application/json" \
    -d "{\"commands\":{\"commands\":[{\"CreateCommand\":{\"templateId\":\"#veil:Veil:$3\",\"createArguments\":$2}}],\"commandId\":\"seed-$3-$RANDOM\",\"actAs\":[\"$1\"],\"userId\":\"$USER_ID\"}}"
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
fi

echo "✓ Bootstrap complete"
