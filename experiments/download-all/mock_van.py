#!/usr/bin/env python3
"""A stand-in for the VAN `GET /people` search endpoint, for testing crawl.sh.

Reproduces the behaviour verified against the live sandbox on 2026-08-04:

  * at least one search parameter is required; paging/filter params and empty
    strings do not count -> 400 INVALID_PARAMETER
  * text criteria are case-insensitive *prefix* matches
  * `$top` defaults to 50 and is capped at 200; `$skip` must be >= 0
  * responses use the `{"items", "nextPageLink", "count"}` envelope
  * `$expand` populates related collections that are otherwise null
  * 429s carry no Retry-After header; the delay is only in the error text

Not a general VAN emulator — it implements exactly what crawl.sh exercises.

Usage:
    mock_van.py --port-file PORT --log LOG [--fail-every N]
"""

from __future__ import annotations

import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SEARCH_FIELDS = (
    "firstName", "lastName", "middleName", "streetAddress", "city",
    "stateOrProvince", "zipOrPostalCode", "phoneNumber", "email",
    "commonName", "officialName",
)
EXPANDABLE = ("addresses", "emails", "phones", "districts")


def build_dataset() -> list[dict]:
    """26 people, shaped to exercise every branch of the crawl.

    ids       lastName            firstName      what it tests
    --------  ------------------  -------------  ----------------------------------
    1001-1012 Alpha01..Alpha12    Zed            multi-page bucket; deep subdivision
    1101-1105 An                  Nora01..05     residue: value == prefix exactly
    1201-1204 Beta1..Beta4        Yan            second seed letter
    1301-1303 (blank)             Quinn1..3      reachable only via firstName
    1401-1402 Omega1..2           Wes1..2        lastName outside the alphabet
    """
    people: list[dict] = []

    def add(van_id, first, last):
        people.append({"vanId": van_id, "firstName": first, "lastName": last})

    for i in range(1, 13):
        add(1000 + i, "Zed", f"Alpha{i:02d}")
    for i in range(1, 6):
        add(1100 + i, f"Nora{i:02d}", "An")
    for i in range(1, 5):
        add(1200 + i, "Yan", f"Beta{i}")
    for i in range(1, 4):
        add(1300 + i, f"Quinn{i}", "")
    for i in range(1, 3):
        add(1400 + i, f"Wes{i}", f"Ómega{i}")

    return people


PEOPLE = build_dataset()


def render(person: dict, expand: list[str]) -> dict:
    """Full Person-ish record: related collections are null unless expanded."""
    out = {
        "vanId": person["vanId"],
        "firstName": person["firstName"] or None,
        "lastName": person["lastName"] or None,
        "contactMode": "Person",
        "contactSource": "API",
    }
    for section in EXPANDABLE:
        out[section] = [] if section in expand else None
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "MockVAN/1.0"
    protocol_version = "HTTP/1.1"

    # -- plumbing ---------------------------------------------------------
    def log_message(self, fmt, *args):  # silence stderr noise
        pass

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, code: str, text: str, prop: str = "All Arguments"):
        self._send(status, {"errors": [{"code": code, "text": text, "properties": [prop]}]})

    # -- the endpoint -----------------------------------------------------
    def do_GET(self) -> None:
        url = urlparse(self.path)
        params = parse_qs(url.query, keep_blank_values=True)

        with self.server.lock:
            self.server.requests += 1
            n = self.server.requests
            self.server.log.write(f"{n}\t{self.path}\n")
            self.server.log.flush()

        if self.server.fail_every and n % self.server.fail_every == 0:
            # Verified live: code is the numeric string "429", the retry delay
            # lives only in the text, and there is no Retry-After header.
            self._send(429, {"errors": [{
                "code": "429",
                "text": "Rate limit exceeded. Try again in 50 ms.",
            }]})
            return

        if url.path != "/people":
            self._error(404, "NOT_FOUND", "No HTTP resource was found.")
            return

        criteria = {
            f: params[f][0] for f in SEARCH_FIELDS
            if params.get(f) and params[f][0].strip()
        }
        if not criteria:
            self._error(400, "INVALID_PARAMETER",
                        "This endpoint requires at least one search parameter to be set.")
            return

        try:
            top = int(params.get("$top", ["50"])[0])
            skip = int(params.get("$skip", ["0"])[0])
        except ValueError:
            self._error(400, "INVALID_PARAMETER", "'$top' must be an integer.", "$top")
            return

        if top < 1:
            self._error(400, "INVALID_PARAMETER", "'$top' must be greater than 0.", "$top")
            return
        if top > 200:
            self._error(400, "INVALID_PARAMETER",
                        "'$top' must be less than or equal to the maximum result size "
                        "for this end point: 200", "$top")
            return
        if skip < 0:
            self._error(400, "INVALID_PARAMETER", "'$skip' must not be negative.", "$skip")
            return

        expand = [
            s.strip().lower() for s in params.get("$expand", [""])[0].split(",") if s.strip()
        ]
        for section in expand:
            if section not in EXPANDABLE:
                self._error(400, "INVALID_PARAMETER",
                            f"'{section}' is not a valid expand value.", "$expand")
                return

        matches = [p for p in PEOPLE if self._matches(p, criteria)]
        page = matches[skip:skip + top]
        nxt = None
        if skip + top < len(matches):
            nxt = f"http://{self.headers.get('Host')}/people?{url.query}".replace(
                f"$skip={skip}", f"$skip={skip + top}"
            )

        self._send(200, {
            "items": [render(p, expand) for p in page],
            "nextPageLink": nxt,
            "count": len(matches),
        })

    @staticmethod
    def _matches(person: dict, criteria: dict) -> bool:
        for field, value in criteria.items():
            got = person.get(field)
            if not isinstance(got, str) or not got.lower().startswith(value.lower()):
                return False
        return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port-file", required=True)
    ap.add_argument("--log", required=True)
    ap.add_argument("--fail-every", type=int, default=0,
                    help="return 429 on every Nth request (0 = never)")
    args = ap.parse_args()

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.lock = threading.Lock()
    httpd.requests = 0
    httpd.fail_every = args.fail_every
    httpd.log = open(args.log, "w")

    with open(args.port_file, "w") as fh:
        fh.write(str(httpd.server_address[1]))

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
