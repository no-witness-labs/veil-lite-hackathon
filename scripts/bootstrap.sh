#!/usr/bin/env bash
# Bootstrap the running Canton sandbox for the Veil demo:
#   1. upload the Veil + simple-token DARs
#   2. allocate demo parties (idempotent)
#   3. create SimpleTokenRules + seed CIP-056 holdings
#   4. write frontend/public/ledger-config.json for the UI
#
# Usage: scripts/bootstrap.sh [JSON_API_URL]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-http://127.0.0.1:6864}"
VEIL_DAR="$ROOT/.daml/dist/veil-0.1.0.dar"
SIMPLE_DAR="$ROOT/dars/simple-token-0.1.0.dar"
CONFIG="$ROOT/frontend/public/ledger-config.json"
USER_ID="veil"

[ -f "$VEIL_DAR" ] || { echo "DAR not found at $VEIL_DAR — run 'dpm build' first." >&2; exit 1; }
[ -f "$SIMPLE_DAR" ] || { echo "simple-token DAR not found at $SIMPLE_DAR." >&2; exit 1; }

upload_dar() {
  local dar="$1" name="$2" code=000 attempt
  echo "→ Uploading $name"
  for attempt in 1 2 3 4 5; do
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v2/packages" \
      -H "Content-Type: application/octet-stream" --data-binary @"$dar")
    [ "$code" = "200" ] && return 0
    echo "  upload attempt $attempt returned HTTP $code, retrying…" >&2
    sleep 2
  done
  echo "DAR upload failed for $name (HTTP $code)" >&2
  return 1
}

upload_dar "$VEIL_DAR" "veil"
for dar in "$ROOT"/dars/splice-api-token-*.dar; do
  upload_dar "$dar" "$(basename "$dar")"
done
upload_dar "$SIMPLE_DAR" "simple-token"

existing="$(curl -s "$BASE/v2/parties")"

allocate() {
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

ledger_offset() {
  curl -s "$BASE/v2/state/ledger-end" | python3 -c 'import sys,json;print(json.load(sys.stdin)["offset"])'
}

submit() {
  # $1 = JSON actAs array, $2 = JSON command object, $3 = command-id prefix
  local resp
  resp=$(curl -s -X POST "$BASE/v2/commands/submit-and-wait-for-transaction" \
    -H "Content-Type: application/json" \
    -d "{\"commands\":{\"commands\":[$2],\"commandId\":\"$3-$RANDOM\",\"actAs\":$1,\"userId\":\"$USER_ID\"}}")
  if ! printf '%s' "$resp" | python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get("transaction") else 1)' 2>/dev/null; then
    echo "Ledger submit failed ($3): $resp" >&2
    return 1
  fi
  printf '%s' "$resp"
}

echo "→ Allocating parties"
LENDER="$(allocate Lender)"
BORROWER="$(allocate Borrower)"
REGULATOR="$(allocate Regulator)"
OUTSIDER="$(allocate Outsider)"
REGISTRY="$(allocate Registry)"
OPERATOR="$(allocate Operator)"

USD="{\"admin\":\"$REGISTRY\",\"id\":\"USD\"}"
TBILL="{\"admin\":\"$REGISTRY\",\"id\":\"TBILL\"}"
EMPTY_META='{"values":{}}'
T0='"2026-01-01T00:00:00Z"'

# Create SimpleTokenRules if not already present.
rules_cid="$(curl -s -X POST "$BASE/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":{\"filtersByParty\":{\"$REGISTRY\":{\"cumulative\":[{\"identifierFilter\":{\"TemplateFilter\":{\"value\":{\"templateId\":\"#simple-token:SimpleToken.Rules:SimpleTokenRules\",\"includeCreatedEventBlob\":false}}}}]}}},\"verbose\":false,\"activeAtOffset\":$(ledger_offset)}" \
  | python3 -c 'import sys,json
d=json.load(sys.stdin)
for e in d:
  ce=e.get("contractEntry",{}).get("JsActiveContract",{}).get("createdEvent",{})
  if ce.get("contractId"): print(ce["contractId"]); break')"

if [ -z "$rules_cid" ]; then
  echo "→ Creating SimpleTokenRules"
  rules_resp="$(submit "[\"$REGISTRY\"]" \
    "{\"CreateCommand\":{\"templateId\":\"#simple-token:SimpleToken.Rules:SimpleTokenRules\",\"createArguments\":{\"admin\":\"$REGISTRY\",\"supportedInstruments\":[\"USD\",\"TBILL\"]}}}" \
    "bootstrap-rules")"
  rules_cid="$(printf '%s' "$rules_resp" | python3 -c 'import sys,json
tx=json.load(sys.stdin).get("transaction",{})
for ev in tx.get("events",[]):
  ce=ev.get("CreatedEvent")
  if ce and "SimpleTokenRules" in ce.get("templateId",""):
    print(ce["contractId"]); break')"
fi

[ -n "$rules_cid" ] || { echo "Failed to create or locate SimpleTokenRules" >&2; exit 1; }

mkdir -p "$(dirname "$CONFIG")"
cat > "$CONFIG" <<JSON
{
  "jsonApiUrl": "$BASE",
  "packageRef": "#veil",
  "simpleTokenPackageRef": "#simple-token",
  "userId": "$USER_ID",
  "parties": {
    "lender": "$LENDER",
    "borrower": "$BORROWER",
    "regulator": "$REGULATOR",
    "outsider": "$OUTSIDER",
    "registry": "$REGISTRY",
    "operator": "$OPERATOR"
  },
  "rulesCid": "$rules_cid",
  "instruments": {
    "usd": { "admin": "$REGISTRY", "id": "USD" },
    "tbill": { "admin": "$REGISTRY", "id": "TBILL" }
  }
}
JSON

echo "→ Wrote $CONFIG"

mint_holding() {
  # $1 = owner, $2 = instrument JSON, $3 = amount
  submit "[\"$REGISTRY\",\"$1\"]" \
    "{\"CreateCommand\":{\"templateId\":\"#simple-token:SimpleToken.Holding:SimpleHolding\",\"createArguments\":{\"admin\":\"$REGISTRY\",\"owner\":\"$1\",\"instrumentId\":$2,\"amount\":\"$3\",\"meta\":$EMPTY_META}}}" \
    "seed-holding"
}

already_seeded="$(curl -s -X POST "$BASE/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d "{\"filter\":{\"filtersByParty\":{\"$BORROWER\":{\"cumulative\":[{\"identifierFilter\":{\"InterfaceFilter\":{\"value\":{\"interfaceId\":\"#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding\",\"includeInterfaceView\":true,\"includeCreatedEventBlob\":false}}}}]}}},\"verbose\":false,\"activeAtOffset\":$(ledger_offset)}" \
  | python3 -c 'import sys,json
d=json.load(sys.stdin)
for e in d:
  ce=e.get("contractEntry",{}).get("JsActiveContract",{}).get("createdEvent",{})
  for iv in ce.get("interfaceViews",[]) or []:
    v=iv.get("viewValue") or {}
    if v.get("instrumentId",{}).get("id")=="TBILL" and not v.get("lock"):
      print("yes"); raise SystemExit
print("no")')"

if [ "$already_seeded" = "yes" ]; then
  echo "→ Holdings already seeded, skipping"
else
  echo "→ Seeding demo holdings (SimpleHolding via registry+owner)"
  mint_holding "$LENDER"   "$USD"   "100"
  mint_holding "$BORROWER" "$USD"   "105"
  mint_holding "$BORROWER" "$TBILL" "150"
fi

echo "✓ Bootstrap complete"
