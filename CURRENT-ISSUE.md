# Current ReelForge Forensic Issue

## Known specimen
- Filename: `50275.mkv`
- Approximate size: 327 MB
- Approximate permanent chunk count: 82
- Chunk size: approximately 4 MiB

## Observed behavior
Immediate playback could come from a local `URL.createObjectURL(file)`. That is device-local and disappears after the browser session/file reference is gone.

After reopening the project, the source did not reliably restore as a usable video. Upload/source-ready states could be reported before end-to-end restoration was proven.

JSON2Video has shown provider-side Processing and an observed AccessDenied response for a copied media URL. These provider responses must be investigated through API status semantics, not treated as proof that the MKV is corrupt.

## Required investigation
1. Audit authentication/project identity and cross-device persistence.
2. Audit chunk manifest and integrity.
3. Prove the 82-chunk specimen can be reconstructed without browser-memory dependence.
4. Prove robust temporary provider upload.
5. Verify provider status and URL semantics.
6. Verify expired provider media can be rebuilt from chunks.
7. Verify transcript/word timestamps.
8. Verify semantic timestamped clip discovery.
9. Verify selected opportunities become explainer previews.
10. Verify final MP4 rendering with dominant explainer voice and ducked source audio.
11. Verify deletion propagation.

Do not require re-upload unless permanent chunks are actually proven corrupt or incomplete.
