# ReelForge Agent Instructions

## Source of truth
- GitHub is the development source of truth.
- The deployed AppDeploy snapshot is the runtime source of truth until deliberately replaced.
- Never treat browser-local state as authoritative.
- Never commit secrets.
- Inspect before patching.

## Cross-device invariant
For the same authenticated account, projects, source assets, processing state, edits, discoveries, renders, and deletions must resolve to the same server-side state on every device.

localStorage, sessionStorage, Blob URLs, IndexedDB, OPFS, and browser memory are cache/acceleration only.

## Source integrity
Permanent 4 MiB chunks are long-term source storage. Before Source Ready, verify expected count, every index, readability, exact byte lengths, SHA-256, aggregate byte count, and applicable container signature. Persist the manifest and verification result.

Temporary reconstructed/provider media is disposable and should target 72-hour retention. Permanent chunks remain until explicit user deletion.

## Explainer pipeline
verified chunks -> Source Master -> transcript/word timestamps -> semantic timestamped opportunities -> selected segment -> hook/script -> ElevenLabs voice -> captions/visuals/music/SFX -> ducked source audio -> preview -> final H.264/AAC MP4.

Storage chunks are not editorial clips.

## Provider rule
JSON2Video is a temporary processing provider, not permanent storage authority. Expired provider media must be rebuildable from verified chunks.

## Engineering
Work on branches. Preserve the baseline. Reconcile tests for user-visible changes. Run type/build/test checks before deployment. Do not claim a fix without evidence.
