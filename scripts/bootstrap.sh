#!/usr/bin/env bash
# Bootstrap the running Canton sandbox for the Veil demo:
#   1. upload the Veil DAR
#   2. allocate the five user roles and the demo issuer (idempotent)
#   3. create the fixed Canton users and grant their least-privilege rights
#   4. write frontend/public/ledger-config.json for the UI
#
# Usage: scripts/bootstrap.sh [JSON_API_URL]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-http://127.0.0.1:6864}"
DAR="$ROOT/.daml/dist/veil-lite-0.7.0.dar"
CONFIG="$ROOT/frontend/public/ledger-config.json"
AUTH_DIR="$ROOT/.local/auth"
ADMIN_HEADER="$AUTH_DIR/headers/participant_admin.txt"
OPERATOR_HEADER="$AUTH_DIR/headers/operator.txt"
USER_ID="veil-operator"

[ -f "$DAR" ] || { echo "DAR not found at $DAR — run 'dpm build' first." >&2; exit 1; }

# Refresh short-lived local tokens without ever putting a bearer value in a
# command argument or in this script's output.  curl reads the generated
# header files with -H @file below.
node "$ROOT/scripts/local-auth.mjs" issue >/dev/null
[ -f "$ADMIN_HEADER" ] || { echo "Missing $ADMIN_HEADER" >&2; exit 1; }
[ -f "$OPERATOR_HEADER" ] || { echo "Missing $OPERATOR_HEADER" >&2; exit 1; }

echo "→ Uploading DAR to $BASE"
code=000
for attempt in 1 2 3 4 5; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/v2/packages" \
    -H "@$ADMIN_HEADER" -H "Content-Type: application/octet-stream" --data-binary @"$DAR")
  [ "$code" = "200" ] && break
  echo "  upload attempt $attempt returned HTTP $code, retrying…" >&2
  sleep 2
done
[ "$code" = "200" ] || { echo "DAR upload failed (HTTP $code)" >&2; exit 1; }

existing="$(curl --fail-with-body -sS -H "@$ADMIN_HEADER" "$BASE/v2/parties")"

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
  curl --fail-with-body -sS -X POST "$BASE/v2/parties" \
    -H "@$ADMIN_HEADER" -H "Content-Type: application/json" \
    -d "{\"partyIdHint\":\"$hint\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['partyDetails']['party'])"
}

echo "→ Allocating parties"
LENDER="$(allocate Lender)"
BORROWER="$(allocate Borrower)"
REGULATOR="$(allocate Regulator)"
VALUER="$(allocate Valuer)"
OUTSIDER="$(allocate Outsider)"
ISSUER="$(allocate DemoIssuer)"

right_act_as() {
  printf '{"kind":{"CanActAs":{"value":{"party":"%s"}}}}' "$1"
}

right_read_as() {
  printf '{"kind":{"CanReadAs":{"value":{"party":"%s"}}}}' "$1"
}

role_rights() {
  printf '[%s,%s]' "$(right_act_as "$1")" "$(right_read_as "$1")"
}

read_only_rights() {
  printf '[%s]' "$(right_read_as "$1")"
}

operator_rights() {
  local issuer="$1" lender="$2" borrower="$3" valuer="$4" regulator="$5" outsider="$6"
  printf '[%s,%s,%s,%s,%s,%s,%s,%s,%s,%s]' \
    "$(right_act_as "$issuer")" \
    "$(right_act_as "$lender")" \
    "$(right_act_as "$borrower")" \
    "$(right_act_as "$valuer")" \
    "$(right_read_as "$issuer")" \
    "$(right_read_as "$lender")" \
    "$(right_read_as "$borrower")" \
    "$(right_read_as "$valuer")" \
    "$(right_read_as "$regulator")" \
    "$(right_read_as "$outsider")"
}

verify_user_rights() {
  local id="$1" expected="$2" actual
  if ! actual="$(curl --fail-with-body -sS -H "@$ADMIN_HEADER" "$BASE/v2/users/$id/rights")"; then
    echo "Could not inspect Canton rights for user $id" >&2
    return 1
  fi

  # Compare only the canonical right kinds.  Canton may add response metadata,
  # but an existing user's extra or missing CanActAs/CanReadAs right must fail
  # closed instead of being silently accepted by an idempotent bootstrap.
  if ! EXPECTED_RIGHTS="$expected" ACTUAL_RIGHTS="$actual" python3 - "$id" <<'PY'
import json
import os
import sys

try:
    expected = json.loads(os.environ["EXPECTED_RIGHTS"])
    payload = json.loads(os.environ["ACTUAL_RIGHTS"])
    actual = payload["rights"]
    if not isinstance(expected, list) or not isinstance(actual, list):
        raise ValueError("rights must be arrays")

    def normalized(rights):
        kinds = []
        for right in rights:
            kind = right.get("kind") if isinstance(right, dict) else None
            if not isinstance(kind, dict):
                raise ValueError("right has no kind")
            kinds.append(json.dumps(kind, sort_keys=True, separators=(",", ":")))
        return sorted(kinds)

    if normalized(expected) != normalized(actual):
        raise ValueError("rights differ")
except (KeyError, TypeError, ValueError, json.JSONDecodeError):
    sys.exit(1)
PY
  then
    echo "Unexpected rights for Canton user $id; use a fresh sandbox or correct user." >&2
    return 1
  fi
}

create_user() {
  local id="$1" primary_party="$2" rights="$3" code
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "@$ADMIN_HEADER" "$BASE/v2/users/$id")"
  case "$code" in
    200)
      curl --fail-with-body -sS -o /dev/null -X POST "$BASE/v2/users/$id/rights" \
        -H "@$ADMIN_HEADER" -H "Content-Type: application/json" \
        -d "{\"userId\":\"$id\",\"rights\":$rights}"
      ;;
    404)
      curl --fail-with-body -sS -o /dev/null -X POST "$BASE/v2/users" \
        -H "@$ADMIN_HEADER" -H "Content-Type: application/json" \
        -d "{\"user\":{\"id\":\"$id\",\"primaryParty\":\"$primary_party\",\"isDeactivated\":false},\"rights\":$rights}"
      ;;
    *)
      echo "Could not inspect Canton user $id (HTTP $code)" >&2
      return 1
      ;;
  esac

  verify_user_rights "$id" "$rights"
}

echo "→ Configuring Canton users and rights"
create_user "$USER_ID" "$ISSUER" "$(operator_rights "$ISSUER" "$LENDER" "$BORROWER" "$VALUER" "$REGULATOR" "$OUTSIDER")"
create_user veil-lender "$LENDER" "$(role_rights "$LENDER")"
create_user veil-borrower "$BORROWER" "$(role_rights "$BORROWER")"
create_user veil-valuer "$VALUER" "$(role_rights "$VALUER")"
create_user veil-regulator "$REGULATOR" "$(read_only_rights "$REGULATOR")"
create_user veil-outsider "$OUTSIDER" "$(read_only_rights "$OUTSIDER")"

mkdir -p "$(dirname "$CONFIG")"
cat > "$CONFIG" <<JSON
{
  "jsonApiUrl": "$BASE",
  "packageRef": "#veil-lite",
  "issuer": "$ISSUER",
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
COLLATERAL_ASSET="Tokenized T-Bill"
# The eligible replacement for collateral substitution, with its own stream.
SUBSTITUTE_ASSET="Tokenized MMF"

create_holding() {
  # $1 = owner; issuance requires both owner and issuer authority.
  curl --fail-with-body -sS -o /dev/null -X POST "$BASE/v2/commands/submit-and-wait-for-transaction" \
    -H "@$OPERATOR_HEADER" -H "Content-Type: application/json" \
    -d "{\"commands\":{\"commands\":[{\"CreateCommand\":{\"templateId\":\"#veil-lite:Veil:$3\",\"createArguments\":$2}}],\"commandId\":\"seed-$3-$RANDOM\",\"actAs\":[\"$ISSUER\",\"$1\"],\"userId\":\"$USER_ID\"}}"
}

ledger_end="$(curl --fail-with-body -sS -H "@$OPERATOR_HEADER" "$BASE/v2/state/ledger-end" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["offset"])')"
already_seeded="$(curl --fail-with-body -sS -X POST "$BASE/v2/state/active-contracts" \
  -H "@$OPERATOR_HEADER" -H "Content-Type: application/json" \
  -d "{\"filter\":{\"filtersByParty\":{\"$BORROWER\":{\"cumulative\":[{\"identifierFilter\":{\"WildcardFilter\":{\"value\":{\"includeCreatedEventBlob\":false}}}}]}}},\"verbose\":false,\"activeAtOffset\":$ledger_end}" \
  | python3 -c 'import sys,json
d=json.load(sys.stdin)
events=[e.get("contractEntry",{}).get("JsActiveContract",{}).get("createdEvent",{}) or {} for e in d]
if any(e.get("templateId", "").endswith((":Veil:CashHolding", ":Veil:CollateralHolding", ":Veil:LoanOffer", ":Veil:Loan", ":Veil:LoanClosed")) and not e.get("createArgument", {}).get("issuer") for e in events):
    sys.exit("Legacy asset contracts found; restart with a fresh 0.7.0 sandbox.")
print(any(e.get("templateId", "").endswith(":Veil:CollateralHolding") and e.get("createArgument", {}).get("issuer") == sys.argv[1] for e in events))' "$ISSUER")"

if [ "$already_seeded" = "True" ]; then
  echo "→ Holdings already seeded, skipping"
else
  echo "→ Seeding demo holdings"
  create_holding "$LENDER"   "{\"issuer\":\"$ISSUER\",\"owner\":\"$LENDER\",\"amount\":\"100\"}"   CashHolding
  create_holding "$BORROWER" "{\"issuer\":\"$ISSUER\",\"owner\":\"$BORROWER\",\"amount\":\"105\"}" CashHolding
  create_holding "$BORROWER" "{\"issuer\":\"$ISSUER\",\"owner\":\"$BORROWER\",\"asset\":\"$COLLATERAL_ASSET\",\"quantity\":\"150\"}" CollateralHolding
  create_holding "$BORROWER" "{\"issuer\":\"$ISSUER\",\"owner\":\"$BORROWER\",\"asset\":\"$COLLATERAL_ASSET\",\"quantity\":\"50\"}" CollateralHolding
  create_holding "$BORROWER" "{\"issuer\":\"$ISSUER\",\"owner\":\"$BORROWER\",\"asset\":\"$SUBSTITUTE_ASSET\",\"quantity\":\"160\"}" CollateralHolding
fi

# All three demo parties authorize the stream; future price updates need only
# the valuer, through a consuming choice that preserves this stream identity.
echo "→ Checking agreed valuation stream"
ledger_end="$(curl --fail-with-body -sS -H "@$OPERATOR_HEADER" "$BASE/v2/state/ledger-end" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["offset"])')"
mark_count="$(curl --fail-with-body -sS -X POST "$BASE/v2/state/active-contracts" \
  -H "@$OPERATOR_HEADER" -H "Content-Type: application/json" \
  -d "{\"filter\":{\"filtersByParty\":{\"$VALUER\":{\"cumulative\":[{\"identifierFilter\":{\"WildcardFilter\":{\"value\":{\"includeCreatedEventBlob\":false}}}}]}}},\"verbose\":false,\"activeAtOffset\":$ledger_end}" \
  | python3 -c 'import sys,json
events=[e.get("contractEntry",{}).get("JsActiveContract",{}).get("createdEvent",{}) for e in json.load(sys.stdin)]
marks=[e for e in events if e.get("templateId", "").endswith(":Veil:CollateralValuation")]
if any("streamId" not in e["createArgument"] for e in marks):
    sys.exit("Legacy valuations found; restart with a fresh 0.7.0 sandbox.")
if any(e.get("templateId", "").endswith(":Veil:ValuationStream") for e in events):
    sys.exit("Unpublished stream found; initialize it before re-running bootstrap.")
print(len(marks))')"
seed_stream() {
  curl --fail-with-body -sS -o /dev/null -X POST "$BASE/v2/commands/submit-and-wait-for-transaction" \
    -H "@$OPERATOR_HEADER" -H "Content-Type: application/json" \
    -d "{\"commands\":{\"commands\":[{\"CreateAndExerciseCommand\":{\"templateId\":\"#veil-lite:Veil:ValuationStream\",\"createArguments\":{\"valuationAgent\":\"$VALUER\",\"lender\":\"$LENDER\",\"borrower\":\"$BORROWER\",\"regulator\":\"$REGULATOR\",\"collateralAsset\":\"$1\"},\"choice\":\"PublishInitial\",\"choiceArgument\":{\"unitPrice\":\"1\"}}}],\"commandId\":\"seed-valuation-$RANDOM\",\"actAs\":[\"$LENDER\",\"$BORROWER\",\"$VALUER\"],\"userId\":\"$USER_ID\"}}"
}
if [ "$mark_count" = "0" ]; then
  seed_stream "$COLLATERAL_ASSET"
  seed_stream "$SUBSTITUTE_ASSET"
elif [ "$mark_count" != "2" ]; then
  echo "Ambiguous valuation streams; use a fresh sandbox." >&2
  exit 1
fi

echo "✓ Bootstrap complete"
