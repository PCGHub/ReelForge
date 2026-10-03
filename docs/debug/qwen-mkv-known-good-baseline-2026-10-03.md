# ReelForge — Qwen 3.8 Max forensic handoff: restore the proven bounded pipeline, diagnose MP4

Date: 2026-10-03

## Known-good baseline restored

ReelForge AppDeploy app: `reelforge-ykctrq`

The production app has been deliberately restored to AppDeploy snapshot/version `1790966432675` (the known-good v78 behavior).

The restored state matches the attached reference screenshot:

- Project: `Land Line`
- Source: `LandLine.2025.480p.x265.AAC.-9jaRocks.Com-.mkv`
- Source size: about 111 MB
- Source duration: 83:34
- Full Video Split: 42 chunks
- Chunk duration: 2:00
- MKV feasibility result:
  - candidate evidence
  - 4 tracks
  - 2111 cues
  - verified source: 28/28 chunks
  - 116,401,501 bytes
  - 0:00–2:00 candidate: 3,120,701 media bytes + 102,451 initialization bytes
- Test result shown in the working UI:
  - `Bounded Web Preview succeeded: 3.1 MB entered the browser instead of 111.0 MB (97.23% less).`
  - The resulting bounded preview played in the browser.

This MKV path is the known-good baseline and must NOT be broken.

## Important architectural rule

Preserve:

- permanent 4 MB source chunks;
- SourceMaster;
- chunk integrity verification;
- Intelligent Discovery;
- transcript/explainer;
- ElevenLabs/audio integration;
- local/browser FFmpeg MP4 export;
- JSON2Video-free Full Video Split.

Do NOT:
- require a re-upload;
- replace the working MKV bounded pipeline;
- reconstruct the full source in the browser;
- move Full Video Split back to JSON2Video;
- make a speculative rewrite without evidence.

## Exact v78 code snapshots extracted from AppDeploy

The exact source is included in this branch:

- `docs/snapshots/v78-freeSplitExport.ts`
- `docs/snapshots/v78-matroskaFeasibility.ts`
- `docs/snapshots/v78-bounded-ui-lines.txt`

These are extracted directly from AppDeploy snapshot `1790966432675`.

## Current bug to solve

The same Full Video Split feature was later extended to MP4.

Affected MP4:

- Project: `india whisky`
- File: `Srinivas-Bellamkonda-Best-Action-Scenes_-_.mp4`
- Size: 70.7 MB
- Permanent chunks: 18
- Verified integrity: 18/18 chunks, 74,165,709/74,165,709 bytes
- Duration parsing was eventually fixed and Full Video Split successfully generated 2-minute chunks.
- But selecting a chunk and using the normal local/browser fast preview repeatedly spent roughly an hour and failed around 30%.
- Investigation showed that the normal MP4 path was falling back to the full-source browser load instead of receiving a bounded candidate.

## Earlier experimental MP4 work

We added an MP4 bounded-prefix planner based on:

- ISO BMFF top-level box parsing;
- `ftyp`;
- `moov`;
- `trak/mdia/mdhd`;
- `stbl/stts`;
- `stsc`;
- `stsz`;
- `stco/co64`;
- video/audio track identification;
- requested 0:00–2:00 sample-to-chunk boundary;
- required prefix byte calculation.

The intention was to make the first 0:00–2:00 MP4 preview use a bounded prefix rather than 70.7 MB.

That experimental MP4 path was rolled back because the normal chunk renderer remained unreliable.

## Your task

Act as a senior TypeScript + ISO BMFF/MP4 + browser FFmpeg engineer.

Analyze the exact known-good v78 code and the MP4 bounded-prefix design.

Do not give a generic MP4 tutorial.

Determine the safest way to extend the proven architecture:

1. Keep the MKV bounded path exactly as the reference implementation.
2. Add MP4 bounded rendering only where the file structure proves it is safe.
3. First establish the actual structure of the stored `india whisky` MP4.
4. Determine whether it is:
   - faststart MP4 with `moov` before `mdat`;
   - fragmented MP4;
   - conventional MP4 with `stts/stsc/stsz/stco/co64`;
   - using `stz2`, edit lists, composition offsets, or other structures that affect safe extraction;
   - dependent on media bytes outside a proposed prefix.
5. Determine whether a simple prefix candidate can actually be opened by browser FFmpeg.
6. If not, specify the smallest server-side remux/patch operation needed to create a standalone bounded MP4 candidate.
7. Keep the full-source browser renderer as a fallback.
8. Do not change later/middle-window behavior until first-window extraction is proven.
9. Add deterministic diagnostics so we can see:
   - ftyp offset/size
   - moov offset/size
   - mvhd timescale/duration
   - track handlers
   - mdhd timescales/durations
   - stts/stsc/stsz details
   - stco/co64 offsets
   - mdat offset/size
   - whether candidate ends inside mdat
   - whether any required chunk/sample offset lies beyond candidate
   - fragmented boxes if present
   - exact candidate bytes
   - exact reduction percentage
10. Use existing permanent chunks; never require a new upload.

## Critical requirement

The screenshot proves the MKV architecture can safely achieve:

3.1 MB browser input instead of 111 MB.

We want the same architectural behavior for MP4 where technically valid.

Do NOT simply hard-code a 3 MB limit.

Calculate the actual candidate size from the source structure.

## Expected answer

Return:

A. Root cause of the MP4 browser-render failure.

B. Evidence required from the actual stored MP4.

C. Corrected ISO BMFF parser/diagnostic implementation.

D. Safe bounded candidate algorithm.

E. If remuxing is necessary, the exact minimal remux strategy.

F. Unit tests and synthetic MP4 fixtures.

G. Exact AppDeploy patch steps.

H. Explicit list of v78 files/routes that must remain unchanged.

The first goal is not to make every MP4 work.

The first goal is:

**prove and implement one safe, bounded MP4 0:00–2:00 preview path without breaking the already-working MKV path.**
