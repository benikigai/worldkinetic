# Accepted prototype package

`POST /api/revisions/:revisionId/package`, JSON `PackageRequestSchema` from `src/shared/package-v2.ts`, contract `wk-prototype-0.2`. The adjacent request fixture is synthetic and cannot download real evidence. Populate revision, acceptance and manifest identities from the verified current acceptance, even when inspecting another candidate.

Optional `rfq`: quantity (integer 1..1000000), material/finish/destination (trimmed single-line strings up to 120 characters), neededBy (valid YYYY-MM-DD). Omitted or null values mean unknown; send null instead of empty strings. These preferences describe a prospective quote, not approved geometry requirements. No preference or package body is persisted by the server or sent to a provider or supplier.

Success: HTTP 200 `application/zip`, attachment `worldkinetics-<revisionId>-prototype.zip`, no-store, Content-Length, and every `PACKAGE_HEADERS` value. Applicability is `current`. The package SHA256 covers the entire ZIP. Verify response identities and SHA256 and recheck that the same acceptance is still current before offering the browser download. A later acceptance or changed requirements invalidates an in-flight download.

ZIP includes original accepted source/editable/STEP/STL bytes, acceptance, manifest, requirements, checks, file hash inventory, readable prototype brief and RFQ. Handle dependencies include verified mount STEP and datums, plus the exact accepted initial STEP used by refinement. No generated drawing or printer-specific G-code is included.

Failure: existing versioned JSON error envelope. Invalid body is 400; stale/unaccepted/mismatched identity or changed requirements is 409 STATE_CONFLICT; missing/corrupt evidence is 409 EVIDENCE_CONFLICT; unavailable reference or ZIP failure is 503 EXPORT_FAILED. Size bound is 25 MiB for archive and total uncompressed contents. Other server errors remain possible and must not produce a download.

This is a stateless read. Repeating identical identities and preferences returns identical ZIP bytes; requestId is echoed for correlation, omitted from archive contents and never reserves a run, edit or stored export receipt. Different preferences can change package bytes without changing any CAD bytes. No automatic retry of a conflicting identity. Backend checks freshness before and after preparing the archive; frontend checks freshness before saving.
