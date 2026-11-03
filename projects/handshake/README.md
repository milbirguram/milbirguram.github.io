# Handshake

## What it is for

Show what happens when a browser retrieves a resource, separating real browser timings from an illustrated explanation. The page's own navigation is shown first. The two public test hosts are named before the user presses the button; there are no automatic external requests, analytics or IP lookup/display.

## How I know

`model.js` parses Navigation/Resource Timing entries into disjoint DNS, TCP, TLS, waiting and response intervals. `connectEnd − connectStart` already includes TLS: when available, TCP ends at `secureConnectionStart` and TLS begins there. HTTP/3 is presented as one combined QUIC transport/encryption interval. The total ends at `responseEnd`, not navigation load completion. Unassigned intervals remain gaps, including browser scheduling. Waiting includes request travel and server work; it does not measure server compute in isolation.

Missing timing exposure produces `null` and “not exposed”, not fabricated zeroes. Valid equal positive timestamps show zero elapsed work with a cached/reused/no fresh lookup explanation. This is not proof of where a DNS answer was cached. A zero TLS start without other evidence is ambiguous. Privacy restrictions can also limit timing. Connection reuse is inferred from exposed equal connect timestamps; a cache-busting request does not guarantee a fresh DNS lookup, socket or TLS session.

Only the Send button handler calls `fetch`, with credentials omitted, no referrer, a cache-busting query and a ten-second timeout. Each body is consumed before its Resource Timing entry is inspected. There are two or five sequential requests per named host. Failed requests are labelled; statistics include successful response times only. Repeats may still open a new connection. Endpoints are tiny pinned public package files, never executed. `tests/endpoints.json` records the actual 2026-11-03 HEAD/GET headers and provider documentation; continued availability and browser exposure are not guaranteed.

The diagram is an illustration, not a capture or inference of actual packets. Recursive DNS can be skipped by caches. TLS resumption and early data are omitted; HTTP/3 uses QUIC, without TCP. The distance number is a very loose one-way upper bound: measured TCP milliseconds × 100 km, using 200,000 km/s in fibre and dividing round trip by two. It is omitted for HTTP/3, reused or hidden connections. It is not geolocation.

Run `node projects/handshake/tests/run-all.js`. Fixtures cover cold h2, reused h2, h3, missing TAO, cached DNS and navigation; stage sums, exposure states and statistics; a static request-boundary check and the recorded endpoint headers. Browser checks also inspect zero external requests before the button and preview lifecycle. The card uses visibly labelled example durations and no external requests. Animation follows `Kit.onPlay` and stops under preview reduced motion.

Fonts Barlow and Barlow Condensed are self-hosted under SIL OFL; sources are pinned in `fonts/`. Serve through the portfolio, which provides the shared kit.

## Sources

- [W3C Resource Timing](https://www.w3.org/TR/resource-timing/) — exposed fields, timing allow checks and reused connections.
- [W3C Navigation Timing](https://www.w3.org/TR/navigation-timing-2/) — page navigation entries.
- [WHATWG Fetch connection timing](https://fetch.spec.whatwg.org/#record-connection-timing-info) — HTTP/3 timing semantics.
- [RFC 1034](https://www.rfc-editor.org/rfc/rfc1034) — DNS model.
- [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293) — TCP handshake.
- [RFC 8446](https://www.rfc-editor.org/rfc/rfc8446) — TLS 1.3 handshake.
- [RFC 9001](https://www.rfc-editor.org/rfc/rfc9001) — TLS integration into QUIC.
- Endpoint terms/documentation and fonts: see `tests/endpoints.json` and `fonts/sources.json`.
