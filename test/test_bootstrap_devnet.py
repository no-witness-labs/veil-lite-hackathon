import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "bootstrap-devnet.py"
spec = importlib.util.spec_from_file_location("bootstrap_devnet", SCRIPT)
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapDevNetTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        dar = Path(directory) / "test.dar"
        dar.write_bytes(b"test DAR")
        self.stack.enter_context(patch.object(bootstrap, "DAR", str(dar)))
        self.stack.enter_context(patch.object(bootstrap.sys, "argv", [str(SCRIPT), "fresh-test"]))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.parties = {role: f"{hint}-fresh-test::namespace" for role, hint in bootstrap.ROLES.items()}

    def test_missing_or_invalid_suffix_stops_before_authentication(self):
        with patch.object(bootstrap, "get_token") as token, patch.dict(bootstrap.os.environ, {}, clear=True):
            for args in [[], [""], ["space here"], ["a" * 65]]:
                with self.subTest(args=args), patch.object(bootstrap.sys, "argv", [str(SCRIPT), *args]):
                    with self.assertRaisesRegex(SystemExit, "fresh run suffix is required"):
                        bootstrap.main()
            token.assert_not_called()

    def test_failed_upload_never_allocates_or_seeds(self):
        with patch.object(bootstrap, "get_token", return_value="test-token"), \
             patch.object(bootstrap, "allocate_parties") as allocate, \
             patch.object(bootstrap, "seed_holdings") as seed, \
             patch.object(bootstrap, "write_config") as config:
            for status in [401, 403, 409, 500]:
                with self.subTest(status=status), patch.object(bootstrap, "api", return_value=(status, {"error": "rejected"})):
                    with self.assertRaisesRegex(SystemExit, "DAR upload failed"):
                        bootstrap.main()
            allocate.assert_not_called()
            seed.assert_not_called()
            config.assert_not_called()

    def test_failed_or_malformed_allocation_never_invents_an_id(self):
        cases = [
            (403, {"partyDetails": {"party": "veilLiteLender-fresh-test::namespace"}}),
            (200, {}),
            (200, {"partyDetails": {"party": "missing-namespace"}}),
            (200, {"partyDetails": {"party": "veilLiteLender-fresh-test::"}}),
        ]
        for response in cases:
            with self.subTest(response=response), patch.object(bootstrap, "api", return_value=response) as api:
                with self.assertRaisesRegex(SystemExit, "Failed to allocate lender"):
                    bootstrap.allocate_parties("test-token", "-fresh-test")
                self.assertEqual(api.call_count, 1)

    def test_mixed_participant_namespaces_are_rejected(self):
        responses = [
            (200, {"partyDetails": {"party": self.parties["lender"]}}),
            (200, {"partyDetails": {"party": "veilLiteBorrower-fresh-test::other-namespace"}}),
        ]
        with patch.object(bootstrap, "api", side_effect=responses):
            with self.assertRaisesRegex(SystemExit, "different participant namespaces"):
                bootstrap.allocate_parties("test-token", "-fresh-test")

    def test_successful_allocation_returns_only_server_ids(self):
        # partyIdHint is advisory: preserve valid IDs allocated by the server.
        allocated = {role: f"server-{role}::namespace" for role in bootstrap.ROLES}
        responses = [(200, {"partyDetails": {"party": party}}) for party in allocated.values()]
        with patch.object(bootstrap, "api", side_effect=responses):
            self.assertEqual(bootstrap.allocate_parties("test-token", "-fresh-test"), allocated)

    def test_same_party_cannot_fill_multiple_roles(self):
        response = (200, {"partyDetails": {"party": self.parties["lender"]}})
        with patch.object(bootstrap, "api", return_value=response):
            with self.assertRaisesRegex(SystemExit, "same party for multiple roles"):
                bootstrap.allocate_parties("test-token", "-fresh-test")

    def run_with_parties(self, active, rights=(200, {})):
        self.stack.enter_context(patch.object(bootstrap, "get_token", return_value="test-token"))
        self.stack.enter_context(patch.object(bootstrap, "api", return_value=(200, {})))
        self.stack.enter_context(patch.object(bootstrap, "allocate_parties", return_value=self.parties))
        grant = self.stack.enter_context(patch.object(bootstrap, "grant_rights", return_value=rights))

        def query_after_grant(token, party):
            grant.assert_called_once_with(token, self.parties)
            return active if party == self.parties["borrower"] else []

        query = self.stack.enter_context(patch.object(bootstrap, "active_contracts", side_effect=query_after_grant))
        holdings = self.stack.enter_context(patch.object(bootstrap, "seed_holdings"))
        valuation = self.stack.enter_context(patch.object(bootstrap, "seed_valuation"))
        config = self.stack.enter_context(patch.object(bootstrap, "write_config"))
        return query, holdings, valuation, config

    def test_existing_contracts_stop_before_seed_or_config(self):
        _, holdings, valuation, config = self.run_with_parties([{"existing": "loan or partial seed"}])
        with self.assertRaisesRegex(SystemExit, "already has active contracts"):
            bootstrap.main()
        holdings.assert_not_called()
        valuation.assert_not_called()
        config.assert_not_called()

    def test_failed_rights_stop_before_query_or_seed(self):
        query, holdings, valuation, config = self.run_with_parties([], rights=(403, {"error": "denied"}))
        with self.assertRaisesRegex(SystemExit, "Failed to grant CanActAs"):
            bootstrap.main()
        for call in [query, holdings, valuation, config]:
            call.assert_not_called()

    def test_fresh_parties_seed_and_write_config(self):
        query, holdings, valuation, config = self.run_with_parties([])
        bootstrap.main()
        self.assertEqual(query.call_count, 5)
        holdings.assert_called_once_with("test-token", self.parties)
        valuation.assert_called_once_with("test-token", self.parties)
        config.assert_called_once_with(self.parties)

    def test_read_only_check_needs_no_dar_and_only_reads_ledger(self):
        with patch.object(bootstrap.sys, "argv", [str(SCRIPT), "--check"]), \
             patch.object(bootstrap, "DAR", "/nonexistent/unused.dar"), \
             patch.object(bootstrap, "get_token", return_value="test-token"), \
             patch.object(bootstrap, "api", return_value=(200, {"offset": 42})) as api, \
             patch.object(bootstrap, "allocate_parties") as allocate, \
             patch.object(bootstrap, "write_config") as config:
            bootstrap.main()
            api.assert_called_once_with("test-token", "GET", "/v2/state/ledger-end")
            allocate.assert_not_called()
            config.assert_not_called()

    def test_read_only_check_reports_ledger_permission_failure(self):
        with patch.object(bootstrap.sys, "argv", [str(SCRIPT), "--check"]), \
             patch.object(bootstrap, "get_token", return_value="test-token"), \
             patch.object(bootstrap, "api", return_value=(403, {"error": "denied"})) as api, \
             patch.object(bootstrap, "allocate_parties") as allocate:
            with self.assertRaisesRegex(SystemExit, "Failed to read ledger end"):
                bootstrap.main()
            api.assert_called_once_with("test-token", "GET", "/v2/state/ledger-end")
            allocate.assert_not_called()

    def test_token_failure_keeps_request_id_and_hides_secret(self):
        secret = "test-secret-never-log"
        for body in [json.dumps({"error": "invalid_grant", "request_id": "support-123", "debug": secret}),
                     json.dumps({"error": secret, "request_id": "support-123"}), "not JSON"]:
            error = urllib.error.HTTPError("https://auth.example/token", 400, "Bad Request", {}, io.BytesIO(body.encode()))
            with self.subTest(body_kind="JSON" if body.startswith("{") else "text"), \
                 patch.multiple(bootstrap, ACCESS_TOKEN=None, TOKEN_URL="https://auth.example/token", CLIENT_ID="test-client", CLIENT_SECRET=secret), \
                 patch.object(bootstrap.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(SystemExit) as raised:
                    bootstrap.get_token()
                message = str(raised.exception)
                self.assertIn("HTTP 400", message)
                self.assertNotIn(secret, message)
                if body.startswith("{"):
                    self.assertIn("support-123", message)

    def test_success_response_without_token_fails_explicitly(self):
        for payload in [{}, {"access_token": ""}, {"access_token": None}]:
            with self.subTest(payload=payload), \
                 patch.multiple(bootstrap, ACCESS_TOKEN=None, TOKEN_URL="https://auth.example/token", CLIENT_ID="test-client", CLIENT_SECRET="test-secret"), \
                 patch.object(bootstrap.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(payload).encode())):
                with self.assertRaisesRegex(SystemExit, "non-empty access_token"):
                    bootstrap.get_token()


if __name__ == "__main__":
    unittest.main()
