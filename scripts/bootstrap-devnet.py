#!/usr/bin/env python3
"""Bootstrap Veil onto the shared HackCanton DevNet participant hosted by NODERS.

Parties are created and the DAR is uploaded in the NODERS node console; this
script only verifies that setup and seeds the demo state:

  1. exchange the team's offline refresh token for a ledger access token
  2. find the six `<namespace>veil-<role>` parties among the ledger user's rights
  3. confirm the locally built DAR's package is on the participant
  4. seed canonical issuer-signed holdings and the agreed valuation stream
  5. write frontend/public/ledger-config.json and print the hosted env values

The refresh token is read from VEIL_UPSTREAM_REFRESH_TOKEN, or from
.local/devnet/tokens.json (the Keycloak token response, kept out of git).
Tokens are never printed.

Usage:
  dpm build
  python3 scripts/bootstrap-devnet.py
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

LEDGER = os.environ.get(
    "VEIL_LEDGER_TARGET", "https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services"
).rstrip("/")
TOKEN_URL = os.environ.get(
    "VEIL_OIDC_TOKEN_URL",
    "https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token",
)
CLIENT_ID = os.environ.get("VEIL_OIDC_CLIENT_ID", "web-app-ui-hackcanton-01-devnet")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS_FILE = os.path.join(ROOT, ".local", "devnet", "tokens.json")
DAR = os.path.join(ROOT, ".daml", "dist", "veil-lite-0.8.2.dar")
CONFIG = os.path.join(ROOT, "frontend", "public", "ledger-config.json")
PACKAGE_REF = "#veil-lite"
COLLATERAL_ASSET = "Tokenized T-Bill"
SUBSTITUTE_ASSET = "Tokenized MMF"
COIN_ASSET = "Canton Coin"
SEED_PRICE = {COIN_ASSET: "0.15"}
ROLES = ("issuer", "lender", "borrower", "regulator", "valuer", "outsider")


def refresh_token():
    value = os.environ.get("VEIL_UPSTREAM_REFRESH_TOKEN", "").strip()
    if value:
        return value
    try:
        with open(TOKENS_FILE, encoding="utf-8") as file:
            value = json.load(file).get("refresh_token", "")
    except (OSError, json.JSONDecodeError):
        value = ""
    if not value:
        sys.exit(f"No refresh token: set VEIL_UPSTREAM_REFRESH_TOKEN or create {TOKENS_FILE} (see docs/DEVNET.md).")
    return value


def access_token():
    body = urllib.parse.urlencode(
        {"grant_type": "refresh_token", "client_id": CLIENT_ID, "refresh_token": refresh_token()}
    ).encode()
    req = urllib.request.Request(
        TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)["access_token"]
    except urllib.error.HTTPError as err:
        sys.exit(f"Token refresh failed (HTTP {err.code}); re-run the Keycloak login in docs/DEVNET.md.")


def token_subject(token):
    segment = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))["sub"]


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


def discover_parties(token, user_id):
    code, resp = api(token, "GET", f"/v2/users/{urllib.parse.quote(user_id)}/rights")
    if code != 200:
        sys.exit(f"Failed to read rights for {user_id} (HTTP {code}): {json.dumps(resp)}")
    act_as, read_as = set(), set()
    for right in resp.get("rights", []):
        kind = right.get("kind", {})
        for name, target in (("CanActAs", act_as), ("CanReadAs", read_as)):
            party = (kind.get(name) or {}).get("value", {}).get("party")
            if party:
                target.add(party)

    parties, problems = {}, []
    for role in ROLES:
        matches = sorted(p for p in act_as if p.split("::", 1)[0].endswith(f"veil-{role}"))
        if len(matches) != 1:
            problems.append(f"{role}: expected one act-as party ending in 'veil-{role}', found {len(matches)}")
            continue
        parties[role] = matches[0]
        if matches[0] not in read_as:
            problems.append(f"{role}: ledger user lacks CanReadAs")
    if problems:
        sys.exit("Create the parties in the NODERS node console first:\n  " + "\n  ".join(problems))
    return parties


def local_package_id():
    with zipfile.ZipFile(DAR) as dar:
        prefix = "veil-lite-0.8.2-"
        for name in dar.namelist():
            top = name.split("/", 1)[0]
            if top.startswith(prefix):
                return top[len(prefix):]
    sys.exit(f"Could not read the package ID from {DAR}")


def check_package(token):
    package_id = local_package_id()
    code, resp = api(token, "GET", "/v2/packages")
    if code != 200:
        sys.exit(f"Failed to list packages (HTTP {code}): {json.dumps(resp)}")
    if package_id not in resp.get("packageIds", []):
        sys.exit(f"Package {package_id} is not on the participant. Upload {DAR} in the node console (Collections).")
    print(f"✓ package {package_id[:12]}… is uploaded")


def ledger_end(token):
    code, resp = api(token, "GET", "/v2/state/ledger-end")
    if code != 200:
        sys.exit(f"Failed to read ledger end (HTTP {code}): {json.dumps(resp)}")
    return resp["offset"]


def active_events(token, party):
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
    return [e.get("contractEntry", {}).get("JsActiveContract", {}).get("createdEvent") or {} for e in resp]


def submit(token, user_id, act_as, command, label):
    body = {
        "commands": {
            "commands": [command],
            "commandId": f"devnet-seed-{label}-{os.urandom(4).hex()}",
            "actAs": act_as,
            "userId": user_id,
        }
    }
    code, resp = api(token, "POST", "/v2/commands/submit-and-wait-for-transaction", json.dumps(body).encode())
    if code != 200:
        sys.exit(f"Failed to seed {label} (HTTP {code}): {json.dumps(resp)}")


def seed_holdings(token, user_id, parties):
    events = active_events(token, parties["borrower"])
    if any(e.get("templateId", "").endswith(":Veil:CollateralHolding") and e.get("createArgument", {}).get("issuer") == parties["issuer"] for e in events):
        print("✓ holdings already seeded")
        return
    creates = [
        (parties["lender"], "CashHolding", {"owner": parties["lender"], "amount": "10000"}),
        (parties["borrower"], "CashHolding", {"owner": parties["borrower"], "amount": "10500"}),
        (parties["borrower"], "CollateralHolding", {"owner": parties["borrower"], "asset": COLLATERAL_ASSET, "quantity": "15000"}),
        (parties["borrower"], "CollateralHolding", {"owner": parties["borrower"], "asset": COLLATERAL_ASSET, "quantity": "5000"}),
        (parties["borrower"], "CollateralHolding", {"owner": parties["borrower"], "asset": SUBSTITUTE_ASSET, "quantity": "16000"}),
    ]
    for owner, template, args in creates:
        args["issuer"] = parties["issuer"]
        command = {"CreateCommand": {"templateId": f"{PACKAGE_REF}:Veil:{template}", "createArguments": args}}
        submit(token, user_id, [parties["issuer"], owner], command, template)
    print("✓ seeded canonical holdings")


def seed_valuation(token, user_id, parties):
    events = active_events(token, parties["valuer"])
    marks = [e for e in events if e.get("templateId", "").endswith(":Veil:CollateralValuation")]
    if any(e.get("templateId", "").endswith(":Veil:ValuationStream") for e in events):
        sys.exit("Unpublished valuation stream found; reset the demo as operator before re-seeding.")
    for asset in (COLLATERAL_ASSET, SUBSTITUTE_ASSET, COIN_ASSET):
        current = [e for e in marks if e.get("createArgument", {}).get("collateralAsset") == asset]
        if len(current) > 1:
            sys.exit(f"Ambiguous {asset} valuation streams; reset the demo as operator before re-seeding.")
        if current:
            print(f"✓ {asset} stream already seeded; publish a fresh mark in the UI if stale")
            continue
        command = {"CreateAndExerciseCommand": {
            "templateId": f"{PACKAGE_REF}:Veil:ValuationStream",
            "createArguments": {
                "valuationAgent": parties["valuer"], "lender": parties["lender"],
                "borrower": parties["borrower"], "regulator": parties["regulator"],
                "collateralAsset": asset,
            },
            "choice": "PublishInitial", "choiceArgument": {"unitPrice": SEED_PRICE.get(asset, "1")},
        }}
        submit(token, user_id, [parties["lender"], parties["borrower"], parties["valuer"]], command, "valuation")
        print(f"✓ seeded jointly authorized {asset} valuation stream")


def write_config(parties):
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    config = {
        "jsonApiUrl": "",
        "packageRef": PACKAGE_REF,
        "issuer": parties["issuer"],
        "parties": {role: party for role, party in parties.items() if role != "issuer"},
    }
    with open(CONFIG, "w", encoding="utf-8") as file:
        json.dump(config, file, indent=2)
        file.write("\n")
    print(f"✓ wrote {CONFIG}")


def main():
    if not os.path.exists(DAR):
        sys.exit(f"DAR not found: {DAR}\n  build it first: dpm build")
    token = access_token()
    user_id = token_subject(token)
    print(f"✓ token acquired for ledger user {user_id}")
    parties = discover_parties(token, user_id)
    for role in ROLES:
        print(f"  {role:9} {parties[role]}")
    check_package(token)
    seed_holdings(token, user_id, parties)
    seed_valuation(token, user_id, parties)
    write_config(parties)
    print("\nNon-secret hosted settings (see docs/DEVNET.md for the secrets):")
    print(f"  VEIL_LEDGER_TARGET={LEDGER}")
    print(f"  VEIL_LEDGER_USER_ID={user_id}")
    print(f"  VEIL_OIDC_TOKEN_URL={TOKEN_URL}")
    print(f"  VEIL_OIDC_CLIENT_ID={CLIENT_ID}")
    print(f"  VEIL_PACKAGE_REF={PACKAGE_REF}")
    for role in ROLES:
        print(f"  VEIL_PARTY_{role.upper()}={parties[role]}")


if __name__ == "__main__":
    main()
