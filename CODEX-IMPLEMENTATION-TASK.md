# ReelForge Explainer — Implementation Task

## Triggering live test

A fresh non-confidential test source was uploaded successfully:

- File: `Srinivas-Bellamkonda-Best-Action-Scenes-_- .mp4`
- Size: approximately 70.7 MB
- Permanent chunks: **18/18 verified**
- Bytes: **74,165,709 / 74,165,709**
- ReelForge UI status: **SOURCE READY**
- Source diagnostics: **JSON2Video media storage is available**
- No re-upload is required.

However, after reopening the project, **Find intelligent clips is visibly disabled and cannot be clicked**.

## Confirmed immediate cause

The current `components/ExplainerStudio.tsx` contains:

```tsx
<button className="primary" disabled={busy || !active.sourceRemoteUrl} onClick={() => void analyze()}>
```

The same component's `analyze()` function contains logic to call `/api/explainer/prepare-source` when `active.sourceRemoteUrl` is absent.

Therefore the UI has a circular prerequisite:

1. Source chunks are verified.
2. No persisted/validated `sourceRemoteUrl` exists.
3. The Analyze button requires `sourceRemoteUrl`.
4. The analyze function that could prepare the source can never be invoked.
5. The current `openProject()` also attempts `prepareSource()`, but that path depends on browser OPFS/in-memory reconstruction and can fail silently into a toast/stopped state.

Do **not** solve this by simply enabling the button and keeping the browser reconstruction architecture. The forensic audit has already established that browser reconstruction must not remain the source-restoration authority.

## Required implementation direction

Implement the narrow Explainer source-lifecycle repair described in:

- `CODEX-TASK.md`
- `FORENSIC-AUDIT-REPORT.md`
- `FORENSIC-FINDINGS.md`
- `CURRENT-ISSUE.md`
- `ARCHITECTURE.md`

### Core invariant

Permanent verified chunks + server-owned Source Master are the source authority.

Browser File/Blob/OPFS must never be required to restore a source.

### Required behavior

After a source reaches `CHUNKS_READY`:

1. The user must be able to initiate intelligent discovery.
2. The UI must not require a browser-local source URL before enabling the action.
3. The server must create/continue a durable source restoration/transfer job.
4. The restoration service must consume verified permanent chunks without constructing a 327 MB browser Blob.
5. Provider media must have explicit states:
   - remote upload pending
   - remote processing
   - remote uploaded/available according to actual provider semantics
   - health verified
   - expired/denied
   - error
6. A provider URL alone must never be treated as source readiness.
7. Transcription and clip preview must require health-verified source readiness.
8. If the temporary provider source expires, the project must remain valid and reconstructible from permanent chunks.
9. UI must poll server-owned operation/source state rather than holding authoritative state in React.

### Immediate UI correction

The final design should remove the circular `!active.sourceRemoteUrl` prerequisite.

The button should be enabled whenever:

- an authenticated project exists,
- permanent source integrity is verified,
- no conflicting operation is running.

Its action should initiate the authoritative server preparation/analysis workflow.

Do not merely change the disabled expression while retaining the browser-dependent restoration path.

## Provider adapter

Centralize JSON2Video integration.

The adapter must own:

- media registration
- exact content type
- exact byte size / required upload headers
- upload lifecycle
- provider status mapping
- readiness verification
- direct usability/health check
- expiry
- deletion
- diagnostic error details

Do not treat `uploaded` as automatically equivalent to application-level `SOURCE_READY` without confirming the provider contract.

## Source Master

Create the narrowest viable server-owned Source Master model.

It should retain:

- project/source identity
- immutable filename/MIME/size
- immutable expected chunk count
- chunk manifest
- overall source hash where available
- integrity verification
- duration/media metadata when known
- transcript/word-timestamp references
- provider reference/status/expiry
- current operation/error state

Avoid a broad ReelForge rewrite.

## Intelligent discovery

Keep editorial discovery separate from storage chunking.

Flow:

```
verified Source Master
  -> health-verified temporary media
  -> ElevenLabs Scribe word timestamps
  -> semantic analysis
  -> timestamped opportunities
  -> selected editorial segment
```

Opportunities must be allowed to cross any number of 4 MiB storage chunks.

## Retention/deletion

Preserve permanent chunks until explicit project/source deletion.

Temporary provider media may expire after approximately 72 hours.

Implement idempotent deletion/cascade for:

- project/source record
- permanent chunks on explicit deletion
- manifest
- provider media
- transcript/analysis artifacts
- preview/render artifacts

Cleanup must paginate projects, respect active operations/leases, and record failed provider deletion for retry.

## Tests required before rollout

At minimum:

1. 18 valid chunks -> CHUNKS_READY.
2. Fresh project after browser restart can initiate discovery without original File.
3. Cross-device same-account source restoration.
4. Provider expiry -> restoration from permanent chunks.
5. Provider pending/processing does not become SOURCE_READY.
6. Provider URL exists but health check fails -> not SOURCE_READY.
7. Discovery works with candidates crossing storage chunk boundaries.
8. Delete on PC -> project/source disappears on mobile and artifacts are cleaned.
9. No 327 MB browser Blob/File reconstruction.
10. Existing unrelated ReelForge features remain unchanged.

## Important constraints

- Do not re-upload the 70.7 MB test source unnecessarily.
- Do not request re-upload of `50275.mkv`.
- Do not delete permanent chunks during provider cleanup.
- Do not put secrets in GitHub.
- Do not silently rewrite unrelated features.
- Do not claim success without tests.
- Run build/typecheck after dependencies are installed.
- If JSON2Video documentation/contract cannot be verified, isolate provider assumptions behind the adapter and report the exact unresolved contract.

## Implementation order

1. Source Master/state model.
2. Provider adapter.
3. Durable restoration/transfer workflow.
4. Explainer UI state/polling.
5. Discovery gating.
6. Retention/deletion.
7. Tests.
8. Only then deploy.

Before implementation, compare this task with the forensic audit and state any contradiction. If none, proceed with the narrow implementation and document the changed files and tests.
