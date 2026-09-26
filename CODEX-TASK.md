# ReelForge — Codex Forensic Audit Task

## Mission

Perform a **forensic audit first**. Do not make production-behavior changes until the audit report is complete.

The immediate problem is the Explainer Studio long-video source lifecycle: a large MKV source can upload into permanent chunks and appear ready, but the source is not reliably restorable/usable across sessions and devices. There have also been JSON2Video `Processing`, `AccessDenied`, and HTTP 502 failures.

The product invariant is:

> **The authenticated account is the source of truth. If the same account uses PC, phone, or another browser, every project, source, change, processing state, preview, and deletion must resolve to the same cloud state.**

Browser-local state may accelerate UX, but it must never be authoritative.

## Read these first

- `AGENTS.md`
- `ARCHITECTURE.md`
- `CURRENT-ISSUE.md`
- `FORENSIC-FINDINGS.md`
- `SOURCE-BASELINE.md`
- `README.md`

Also inspect the complete repository before drawing conclusions.

## Audit rules

1. Do not blindly patch the current implementation.
2. Do not replace working architecture merely because it is inconvenient.
3. Trace the actual request/data lifecycle from authentication through final delivery.
4. Distinguish:
   - permanent source storage
   - temporary provider/media storage
   - editorial clip timestamps
   - browser cache
   - project/database state
5. Treat a provider URL existing as **not sufficient** evidence that a source is ready.
6. Treat a provider status of `uploaded`, `processing`, `pending`, or equivalent according to the provider's actual API semantics.
7. Do not require re-upload of the forensic specimen `50275.mkv` unless permanent chunk integrity is proven bad.
8. Never put secrets into source control.

---

# 1. Trace the complete source lifecycle

Follow the real code path for:

**auth → workspace → project creation → 4 MiB chunk upload → chunk verification → manifest → source restoration → provider registration → provider upload → provider readiness → transcription → intelligent discovery → clip preview → explainer production → final render → deletion.**

For every stage identify:

- route/function
- database record(s)
- storage path(s)
- state/status written
- source of truth
- failure modes
- whether another device can reproduce the same state

Produce a state-transition diagram.

---

# 2. Audit authentication and cross-device persistence

The requirement is strict:

> Same authenticated account = same cloud state on PC and mobile.

Audit every Explainer Studio state field and every relevant project field.

Specifically search for:

- `localStorage`
- `sessionStorage`
- `URL.createObjectURL`
- Blob URLs
- `File`
- `FileReader`
- OPFS / `navigator.storage`
- IndexedDB
- in-memory project state
- browser-only source URLs
- device-generated project IDs
- cached project lists
- cached upload status

Classify each as:

### Authoritative
Must live server-side.

### Cache/acceleration
Allowed locally, but must be reconstructible from server state.

### Dangerous
Can make one device disagree with another device.

Pay special attention to:

- `sourcePreviewUrl`
- `sourceUrl`
- `sourceRemoteUrl`
- `sourceRemoteReady`
- active project state
- upload progress
- discovery opportunities
- selected clip
- render status
- delete state

Report any cross-device inconsistency you find.

---

# 3. Audit the permanent chunk architecture

Permanent source chunks are intended to be the durable source of truth.

Verify that the implementation proves:

- expected chunk count
- every index exists
- every chunk is readable
- Base64 decodes correctly
- exact expected byte size
- SHA-256 matches the uploaded hash
- total bytes match original source size
- manifest matches actual storage
- MKV signature/container evidence is checked where applicable

Verify whether `Source Ready` can ever be written before these checks pass.

Verify whether an incomplete or corrupted chunk set can masquerade as a valid source.

Inspect:

- `upload-chunk`
- `complete-upload`
- `upload-status`
- `source-integrity`
- `verifyExplainerChunks`
- manifest creation and update logic

---

# 4. Audit source restoration

This is the critical area.

Determine whether the current implementation can reconstruct a usable source from permanent chunks **without depending on the browser to hold a 327 MB Blob**.

The forensic specimen is:

- filename: `50275.mkv`
- approximately 327 MB
- 82 chunks
- approximately 4 MiB per chunk

Do not ask for re-upload unless integrity verification fails.

Trace all current restoration paths, including:

- `prepare-source`
- `prepareExplainerRemoteSource`
- `source-chunk-urls`
- `source-upload-session`
- `source-upload-status`
- OPFS path
- browser File fallback
- any server-side reconstruction

Identify if multiple restoration architectures currently coexist.

If they do, document which one is actually used by each UI action.

---

# 5. Audit JSON2Video integration

Inspect all JSON2Video calls and compare them with the provider's documented API semantics.

Specifically verify:

- media registration
- upload URL generation
- folder/path handling
- `temp` vs permanent folders
- presigned URL expiry
- maximum upload size
- PUT requirements
- `Content-Length`
- media status polling
- `pending`
- `processing`
- `uploaded`
- public/file URL semantics
- deletion
- whether a returned URL can be directly opened in a browser
- whether `AccessDenied` means source corruption or provider authorization/lifecycle behavior

Investigate the observed:

- HTTP 502
- `Processing...`
- `AccessDenied`

Do not assume any of these proves the MKV is corrupt.

Determine whether the current architecture can reliably move a ~327 MB source through the provider's upload lifecycle within the platform's request/runtime constraints.

Pay particular attention to the documented ~120-second presigned upload URL lifetime.

---

# 6. Separate Source Master from provider media

The intended architecture should have a provider-independent logical source layer.

Define what the repository currently has versus what it needs.

A Source Master should conceptually contain:

- project ID
- original filename
- MIME
- total bytes
- chunk count
- chunk manifest
- overall SHA-256
- integrity verification timestamp
- source status
- duration
- video dimensions
- FPS
- codecs
- stream information
- transcript reference
- word timestamps
- provider media reference (temporary, if any)
- provider expiry/last verification

Provider media must be treated as temporary acceleration, not permanent truth.

If the provider source expires, the project should remain valid and reconstructible from permanent chunks.

---

# 7. Define and audit the source state machine

Trace every state currently used.

The target conceptual states are:

- EMPTY
- UPLOADING_CHUNKS
- VERIFYING_CHUNKS
- CHUNKS_READY
- RESTORING_SOURCE
- REMOTE_UPLOAD_PENDING
- REMOTE_PROCESSING
- SOURCE_READY
- ANALYZING
- ANALYSIS_READY
- EXPIRED_REMOTE_SOURCE
- ERROR

Document the actual current states and where they are written.

Identify ambiguous states such as:

- `Source Ready` when only chunks exist
- `ready` when provider URL exists but provider has not confirmed availability
- provider `uploaded` versus actual usable source
- temporary provider expiry versus permanent source availability

Recommend a normalized state machine before implementation.

---

# 8. Audit intelligent clip discovery

Discovery must be based on the source's content, not storage chunk boundaries.

Verify the flow:

**source → transcript/word timestamps → semantic analysis → timestamped opportunities → editorial clip segment → explainer script.**

Each opportunity should have:

- start timestamp
- end timestamp
- duration
- title
- hook
- reason
- discovery mode
- confidence/evidence
- transcript excerpt

Check that a candidate can cross multiple 4 MiB storage chunks.

Reject any architecture that treats storage chunks as editorial clips.

Audit the requested discovery modes:

- viral
- story
- surprise
- funny
- emotional
- educational
- drama

---

# 9. Audit preview and final explainer production

Trace:

**selected source segment → hook/script → ElevenLabs voice → captions → music/SFX → source audio ducking → render → MP4.**

Verify:

- source video remains visible
- source audio is reduced, roughly 10–20% of normal level
- ElevenLabs explainer voice is dominant
- captions are synchronized
- final output is MP4
- preview and final render use the same logical segment
- final output is downloadable
- render status is persisted server-side

Do not assume browser-only preview state is enough.

---

# 10. Audit deletion propagation

Find all project deletion paths.

Verify that deleting an Explainer project removes or marks for deletion:

- project database record
- permanent chunk objects
- manifest
- temporary provider media
- thumbnails/previews
- transcript/analysis artifacts
- render artifacts
- any cached references

Also verify that deleting from PC causes the project to disappear from mobile for the same account, and vice versa.

If there is no Explainer-specific deletion route, document it as a concrete gap.

---

# 11. Audit the 72-hour retention rule

The intended policy is:

- permanent 4 MiB chunks remain until user explicitly deletes the source/project
- full temporary/provider source may be retained for approximately 72 hours
- expired temporary source must be treated as expired, not as project loss
- the system must be able to rebuild/recreate the temporary source from permanent chunks

Audit:

- `cron.json`
- cleanup handler
- timestamp fields
- provider path parsing
- cleanup idempotency
- race conditions with active processing
- cross-device behavior after expiry

---

# 12. Tests required after the audit

Do not implement these until the audit identifies the correct architecture, but prepare a test plan for:

### Cross-device
1. Log in on PC.
2. Create project.
3. Upload source.
4. Verify on mobile using same account.
5. Make a project change on mobile.
6. Verify on PC.
7. Delete on PC.
8. Verify disappearance on mobile.

### Integrity
- 82 valid chunks
- missing chunk
- wrong chunk length
- altered bytes
- wrong SHA-256
- wrong total byte count
- invalid manifest

### Restoration
- restore from chunks after browser restart
- restore from chunks after provider source expiry
- restore from chunks without creating a 327 MB browser Blob where possible

### Provider
- registration succeeds
- upload fails
- upload URL expires
- provider reports processing
- provider reports uploaded
- provider returns AccessDenied
- provider media disappears
- source remains recoverable

### Discovery
- transcript with word timestamps
- opportunities crossing storage chunk boundaries
- all requested discovery modes
- explainable timestamp evidence

### Rendering
- real source clip preview
- source audio ducking
- ElevenLabs voice dominance
- captions
- final MP4

### Deletion
- project record
- permanent chunks
- provider media
- artifacts
- cross-device visibility

---

# 13. Required audit report

Before changing production behavior, produce a report with exactly these sections:

## A. Executive Findings

What is actually broken and what is already correct.

## B. Evidence

File paths, functions, routes, state fields, and concrete code evidence.

## C. Root Causes

Separate confirmed root causes from hypotheses.

## D. Architecture Conflicts

Especially mixed browser reconstruction vs server/provider workflows.

## E. Cross-Device Audit

What is authoritative and what is device-local.

## F. Source Integrity Audit

Whether 50275.mkv's 82 chunks can be proven valid.

## G. JSON2Video Audit

Explain 502, Processing, AccessDenied, upload lifecycle, and expiry constraints.

## H. Source Master / State Machine

Proposed normalized model.

## I. Intelligent Discovery Audit

Current flow and required changes.

## J. Deletion + 72h Retention Audit

Concrete gaps.

## K. Repair Plan

Prioritized phases, with dependencies.

## L. Test Plan

Tests that prove the repair.

## M. Implementation Recommendation

Give the exact architecture you recommend **before writing code**.

---

# 14. Hard constraints

- Do not delete or invalidate permanent source chunks.
- Do not require re-upload of 50275.mkv unless integrity verification proves corruption.
- Do not store secrets in GitHub.
- Do not make browser Blob/OPFS the source of truth.
- Do not treat JSON2Video as the permanent source database.
- Do not treat 4 MiB storage chunks as editorial clips.
- Do not silently change unrelated ReelForge features.
- Do not perform a broad rewrite.
- Do not mark a source ready merely because a URL exists.
- Do not claim a fix works without a test proving it.

## Final instruction

**Audit first. Report second. Implement third.**

Start by reading the repository and running the relevant tests. Do not modify production behavior until the forensic report identifies the exact root cause and the proposed repair architecture.
