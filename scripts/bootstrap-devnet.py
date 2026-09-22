#!/usr/bin/env python3
"""Bootstrap Veil Lite onto the shared Seaport/Five North Canton DevNet.

Reads DevNet credentials from the environment, uploads the DAR, allocates demo
parties, grants the ledger user CanActAs rights, seeds canonical holdings, and
writes frontend/public/ledger-config.json.

Usage:
  set -a; . frontend/.env.local; set +a
  python3 scripts/bootstrap-devnet.py season3-20260922

Use a new suffix for each run on DevNet's persistent ledger:
  python3 scripts/bootstrap-devnet.py run2
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = os.environ.get("VEIL_OIDC_TOKEN_URL")
LEDGER = os.environ.get("VEIL_LEDGER_TARGET", "https://ledger-api.validator.devnet.sandbox.fivenorth.io").rstrip("/")
CLIENT_ID = os.environ.get("VEIL_OIDC_CLIENT_ID")
CLIENT_SECRET = os.environ.get("VEIL_OIDC_CLIENT_SECRET")
AUDIENCE = os.environ.get("VEIL_OIDC_AUDIENCE", CLIENT_ID or "")
SCOPE = os.environ.get("VEIL_OIDC_SCOPE", "daml_ledger_api")
USER_ID = os.environ.get("VEIL_LEDGER_USER_ID", "6")
ACCESS_TOKEN = os.environ.get("VEIL_DEVNET_ACCESS_TOKEN")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAR = os.path.join(ROOT, ".daml", "dist", "veil-lite-0.3.0.dar")
CONFIG = os.path.join(ROOT, "frontend", "public", "ledger-config.json")
PACKAGE_REF = "#veil-lite"
COLLATERAL_ASSET = "Tokenized T-Bill / MMF"

ROLES = {
    "lender": "veilLiteLender",
    "borrower": "veilLiteBorrower",
    "regulator": "veilLiteRegulator",
    "valuer": "veilLiteValuer",
    "outsider": "veilLiteOutsider",
}


def get_token():
    if ACCESS_TOKEN:
        return ACCESS_TOKEN
    missing = [
        name
        for name, value in {
            "VEIL_OIDC_TOKEN_URL": TOKEN_URL,
            "VEIL_OIDC_CLIENT_ID": CLIENT_ID,
            "VEIL_OIDC_CLIENT_SECRET": CLIENT_SECRET,
        }.items()
        if not value
    ]
    if missing:
        sys.exit("Missing DevNet env: " + ", ".join(missing))

    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "audience": AUDIENCE,
            "scope": SCOPE,
        }
    ).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    return json.load(urllib.request.urlopen(req, timeout=30))["access_token"]


def api(token, method, path, data=None, content_type="application/json"):
    headers = {"Authorization": f"Bearer {token}"}
    if data is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(LEDGER + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            body = res.read()
            return res.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as err:
        body = err.read()
        try:
            return err.code, json.loads(body) if body else {}
        except json.JSONDecodeError:
            return err.code, {"raw": body.decode(errors="replace")}


def allocate_parties(token, suffix):
    parties = {}
    namespace = None
    for role, base_hint in ROLES.items():
        hint = base_hint + suffix
        code, resp = api(token, "POST", "/v2/parties", json.dumps({"partyIdHint": hint}).encode())
        party = (resp.get("partyDetails") or {}).get("party")
        if code != 200 or not isinstance(party, str) or "::" not in party or not all(party.split("::", 1)):
            sys.exit(f"Failed to allocate {role} (HTTP {code}): {json.dumps(resp)}. Use a new run suffix; no party ID was inferred.")
        if party in parties.values():
            sys.exit("The participant returned the same party for multiple roles; no rights or assets were created.")
        party_namespace = party.split("::", 1)[1]
        if namespace is not None and party_namespace != namespace:
            sys.exit("Allocated parties have different participant namespaces; no rights or assets were created.")
        namespace = party_namespace
        parties[role] = party

    return parties


def grant_rights(token, parties):
    rights = [{"kind": {"CanActAs": {"value": {"party": party}}}} for party in parties.values()]
    return api(
        token,
        "POST",
        f"/v2/users/{USER_ID}/rights",
        json.dumps({"userId": USER_ID, "rights": rights}).encode(),
    )


def ledger_end(token):
    code, resp = api(token, "GET", "/v2/state/ledger-end")
    if code != 200:
        sys.exit(f"Failed to read ledger end (HTTP {code}): {json.dumps(resp)}")
    return resp["offset"]


def active_contracts(token, party):
    body = {
        "filter": {
            "filtersByParty": {
                party: {
                    "cumulative": [
                        {"identifierFilter": {"WildcardFilter": {"value": {"includeCreatedEventBlob": False}}}}
                    ]
                }
            }
        },
        "verbose": False,
        "activeAtOffset": ledger_end(token),
    }
    code, resp = api(token, "POST", "/v2/state/active-contracts", json.dumps(body).encode())
    if code != 200:
        sys.exit(f"Failed to read active contracts (HTTP {code}): {json.dumps(resp)}")
    return resp


def already_seeded(token, borrower):
    entries = active_contracts(token, borrower)
    for entry in entries:
        event = (entry.get("contractEntry", {}).get("JsActiveContract", {}).get("createdEvent") or {})
        if "CollateralHolding" in str(event.get("templateId", "")):
            return True
    return False


def submit_create(token, party, template_name, create_arguments):
    command = {
        "commands": {
            "commands": [
                {
                    "CreateCommand": {
                        "templateId": f"{PACKAGE_REF}:Veil:{template_name}",
                        "createArguments": create_arguments,
                    }
                }
            ],
            "commandId": f"devnet-seed-{template_name}-{os.urandom(4).hex()}",
            "actAs": [party],
            "userId": USER_ID,
        }
    }
    return api(token, "POST", "/v2/commands/submit-and-wait-for-transaction", json.dumps(command).encode())


def seed_holdings(token, parties):
    if already_seeded(token, parties["borrower"]):
        print("✓ holdings already seeded")
        return

    creates = [
        (parties["lender"], "CashHolding", {"owner": parties["lender"], "amount": "100"}),
        (parties["borrower"], "CashHolding", {"owner": parties["borrower"], "amount": "105"}),
        (
            parties["borrower"],
            "CollateralHolding",
            {"owner": parties["borrower"], "asset": COLLATERAL_ASSET, "quantity": "150"},
        ),
        (
            parties["borrower"],
            "CollateralHolding",
            {"owner": parties["borrower"], "asset": COLLATERAL_ASSET, "quantity": "50"},
        ),
    ]
    for party, template_name, args in creates:
        code, resp = submit_create(token, party, template_name, args)
        if code != 200:
            sys.exit(f"Failed to seed {template_name} (HTTP {code}): {json.dumps(resp)}")
    print("✓ seeded canonical holdings")


def write_config(parties):
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    config = {
        "jsonApiUrl": LEDGER,
        "packageRef": PACKAGE_REF,
        "userId": USER_ID,
        "parties": parties,
    }
    with open(CONFIG, "w", encoding="utf-8") as file:
        json.dump(config, file, indent=2)
        file.write("\n")
    print(f"✓ wrote {CONFIG}")


def seed_valuation(token, parties):
    entries = active_contracts(token, parties["valuer"])
    events = [e.get("contractEntry", {}).get("JsActiveContract", {}).get("createdEvent", {}) for e in entries]
    marks = [e for e in events if e.get("templateId", "").endswith(":Veil:CollateralValuation")]
    if any("streamId" not in e["createArgument"] for e in marks):
        sys.exit("Legacy valuations found; use a fresh party suffix for version 0.3.0.")
    if len(marks) > 1 or any(e.get("templateId", "").endswith(":Veil:ValuationStream") for e in events):
        sys.exit("Ambiguous or unpublished valuation streams; use a fresh party suffix.")
    if marks:
        print("✓ valuation stream already seeded; publish a fresh mark in the UI if stale")
        return
    command = {
        "commands": {
            "commands": [{"CreateAndExerciseCommand": {
                "templateId": f"{PACKAGE_REF}:Veil:ValuationStream",
                "createArguments": {
                    "valuationAgent": parties["valuer"], "lender": parties["lender"],
                    "borrower": parties["borrower"], "regulator": parties["regulator"],
                    "collateralAsset": COLLATERAL_ASSET,
                },
                "choice": "PublishInitial", "choiceArgument": {"unitPrice": "1"},
            }}],
            "commandId": f"devnet-seed-valuation-{os.urandom(4).hex()}",
            "actAs": [parties["lender"], parties["borrower"], parties["valuer"]],
            "userId": USER_ID,
        }
    }
    code, resp = api(token, "POST", "/v2/commands/submit-and-wait-for-transaction", json.dumps(command).encode())
    if code != 200:
        sys.exit(f"Failed to seed valuation stream (HTTP {code}): {json.dumps(resp)}")
    print("✓ seeded jointly authorized valuation stream")


def main():
    if not os.path.exists(DAR):
        sys.exit(f"DAR not found: {DAR}\n  build it first: dpm build")

    tag = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("VEIL_PARTY_SUFFIX", "")).strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", tag):
        sys.exit("A fresh run suffix is required (1–64 letters, digits, underscores or hyphens). Example: python3 scripts/bootstrap-devnet.py season3-20260922")
    suffix = f"-{tag}"
    print(f"run tag: {tag} -> parties suffixed with {suffix}")

    token = get_token()
    print("✓ token acquired")

    with open(DAR, "rb") as dar_file:
        code, resp = api(token, "POST", "/v2/packages", dar_file.read(), "application/octet-stream")
    if code != 200:
        sys.exit(f"DAR upload failed (HTTP {code}): {json.dumps(resp)}. No parties or assets were created.")
    print("✓ DAR uploaded")

    parties = allocate_parties(token, suffix)
    for role in ROLES:
        print(f"  {role:9} {parties[role]}")

    code, resp = grant_rights(token, parties)
    if code != 200:
        sys.exit(f"Failed to grant CanActAs to user {USER_ID} (HTTP {code}): {json.dumps(resp)}")
    print(f"✓ granted CanActAs x{len(parties)} to user {USER_ID}")

    # Query only after rights are granted. Never treat a partially seeded or
    # prior loan environment as a new Season 3 demo.
    for role, party in parties.items():
        if active_contracts(token, party):
            sys.exit(f"The {role} party already has active contracts; use a fresh run suffix. No assets were seeded.")

    seed_holdings(token, parties)
    seed_valuation(token, parties)
    write_config(parties)
    print("Done. Start the frontend with: npm --prefix frontend run dev")


if __name__ == "__main__":
    main()
