# ReelForge Architecture Baseline

## Four layers
1. Source Storage — authenticated project, permanent chunks, manifest, temporary provider copy.
2. Source Intelligence — Source Master, media metadata, transcript, word timestamps, semantic opportunities.
3. Explainer Production — selected segment, hook/script, ElevenLabs narration, captions, visuals, music/SFX, ducking, preview/render.
4. Delivery — final MP4, download reference, render/project history.

## Intended source states
EMPTY -> UPLOADING_CHUNKS -> VERIFYING_CHUNKS -> CHUNKS_READY -> RESTORING_SOURCE -> REMOTE_UPLOAD_PENDING -> REMOTE_PROCESSING -> SOURCE_READY -> ANALYZING -> ANALYSIS_READY

Failure/expiry states include ERROR and EXPIRED_REMOTE_SOURCE -> RESTORING_SOURCE.

## Cross-device
Authenticated account + server project ID are the stable identity boundary. A device may remember a selected project for convenience, but must re-resolve it from the server after authentication. Blob URLs are never persistent source URLs.

## Provider lifecycle
Persist provider path/id, status, created/expiry metadata, project ID, and enough information to reconstruct from permanent chunks.

## Current risk
The captured baseline contains a JSON2Video path that streams many signed chunks through one backend request. This has produced long-upload/provider-processing failures and must be audited before reuse.
