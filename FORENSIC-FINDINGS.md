# Forensic Findings — Initial Pass

Date: 2026-09-26
Runtime baseline: AppDeploy `reelforge-ykctrq` version `1790439292981`

## Confirmed strengths

- Explainer projects are queried by authenticated workspace on the server.
- Source chunks are stored server-side and the backend verifies byte lengths and SHA-256 before Source Ready.
- A source manifest is persisted after successful integrity verification.
- Chunk paths are namespaced by authenticated workspace and project.
- Temporary provider media has explicit creation metadata and a 72-hour cleanup path.
- Source preparation can be initiated again from permanent chunks.

## High-risk findings

### 1. Provider URL presence is treated as readiness

The frontend skips source restoration when `sourceRemoteUrl` is present. It does not first prove that the provider URL is still reachable or that the provider status is still ready.

Consequence: a stale or inaccessible provider URL can block automatic restoration even though permanent chunks remain available.

Required correction: provider readiness must be verified by server-side provider state/health. If stale, expired, missing, or inaccessible, transition to restoration from permanent chunks.

### 2. Large source restoration still depends on the browser

The current `prepareSource` path obtains every signed chunk, reconstructs the full source in browser OPFS when available, and then uploads that full file to JSON2Video using a presigned URL.

For a roughly 327 MB / 82-chunk source, this remains device- and browser-dependent and is vulnerable to browser lifecycle, mobile storage, network interruption, and presigned upload expiry.

Required correction: prefer a server/provider transfer architecture that does not require the browser to reconstruct the entire source. If a browser handoff remains necessary, it must be resumable and must not be the only restoration path.

### 3. Provider upload session lifetime is a hard constraint

The current session records an approximately 120-second presigned upload expiry. A 327 MB upload cannot safely assume completion within that window, especially on mobile or unstable connections.

Required correction: measure the provider's supported transfer mechanism and implement a transfer strategy that is compatible with its expiry/resume semantics. Do not hide expiry as a generic processing error.

### 4. Source Ready and provider Ready are separate concepts

Permanent chunk integrity is the durable source guarantee. JSON2Video readiness is temporary processing availability. The state model should make that distinction explicit instead of conflating them through a single source-ready UI state.

### 5. Editorial discovery should remain independent of storage chunking

The application already exposes logical start/end opportunities. Those timestamps must remain the editorial source of truth; 4 MiB storage chunks must never become the clip boundaries.

## Next engineering target

Implement and test a provider-independent Source Master restoration service:

verified permanent chunks
-> server-side restoration/transfer
-> temporary provider media
-> provider health/status verification
-> transcript
-> semantic opportunities
-> real source preview
-> explainer production

Cross-device restoration must be tested by opening the same authenticated project on a second device/browser without the original local File object.
