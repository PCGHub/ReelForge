# ReelForge Fast Web Preview — Verified MP4 Chunk 01 Failure Investigation

Date: 2026-10-03

## Objective

Investigate the current ReelForge Explainer Studio failure where **Full Video Split succeeds**, but **Render Fast Web Preview** for the first 2-minute MP4 chunk fails after prolonged local browser processing.

This evidence bundle is extracted from the current AppDeploy production source for app `reelforge-ykctrq`.

- AppDeploy app: `reelforge-ykctrq`
- Current deployed snapshot: `1791031272689`
- Repository: `PCGHub/ReelForge`
- Affected project: `india whisky`
- Source: `Srinivas-Bellamkonda-Best-Action-Scenes_-_.mp4`
- Source size: approximately 70.7 MB
- Permanent chunks: 18
- Previously verified: 18/18 chunks, 74,165,709 / 74,165,709 bytes
- Split timeline now works: 2-minute chunks are successfully generated.
- Current failure: local Fast Web Preview for Chunk 01 takes a very long time and fails; the observed run reached approximately 30% after about one hour.

## Important distinction

The previous `mp4_duration_not_found` problem has been solved enough for Full Video Split to generate the 2-minute timeline.

The current problem is downstream:

```
Full Video Split
    ↓
Chunk 01 (0:00 → 2:00) exists
    ↓
Render Fast Web Preview
    ↓
bounded MP4 candidate is requested
    ↓
browser local preview path
    ↓
failure / prolonged stall around 30%
```

Do not reopen the duration problem unless evidence shows it is involved.

---

# Current architecture constraints

Preserve:

- permanent 4 MB source chunks;
- SourceMaster / server-owned source lifecycle;
- source integrity verification;
- Intelligent Discovery;
- transcript/explainer;
- ElevenLabs/audio;
- existing local/browser FFmpeg export;
- JSON2Video-free Full Video Split;
- no unnecessary re-upload.

Do not redesign ReelForge.

The purpose of this investigation is to determine why the supposedly bounded first-window MP4 cannot be used as a fast browser preview.

---

# Exact current AppDeploy code

## 1. Frontend bounded preview path

Source: `lib/freeSplitExport.ts`.

Current relevant code:

```ts
const loadBoundedCandidateForWindow = async (
  projectId: string,
  start: number,
  duration: number,
  onProgress?: (percent: number) => void,
  onStatus?: (status: string) => void
) => {
  const end = start + duration;
  const response = await api.post(
    '/api/explainer/bounded-source-plan',
    { projectId, startSeconds: start, endSeconds: end }
  );

  const bytes = Number(response.data?.requiredBytes || 0);
  const sourceBytes = Number(response.data?.sourceBytes || 0);

  if (!bytes || !sourceBytes)
    throw new Error('bounded_candidate_plan_unavailable');

  if (!Boolean(response.data?.withinGuardrail))
    throw new Error(
      'bounded_candidate_guardrail_exceeded:' +
      (bytes / 1024 / 1024).toFixed(1) +
      'MB/' +
      (sourceBytes / 1024 / 1024).toFixed(1) +
      'MB'
    );

  onStatus?.(
    `Loading bounded prefix: ${(bytes / 1024 / 1024).toFixed(1)} MB instead of ${(sourceBytes / 1024 / 1024).toFixed(1)} MB…`
  );

  const candidate = new Uint8Array(bytes);
  let offset = 0;

  while (offset < bytes) {
    const size = Math.min(2 * 1024 * 1024, bytes - offset);
    const data = await loadSourceRange(
      projectId,
      offset,
      size,
      onStatus
    );

    candidate.set(data, offset);
    offset += data.byteLength;

    onProgress?.(
      Math.min(
        35,
        28 + Math.round((offset / bytes) * 7)
      )
    );
  }

  if (offset !== bytes)
    throw new Error(
      `bounded_candidate_assembly_mismatch:${offset}/${bytes}`
    );

  return {
    candidate,
    bytes,
    sourceBytes,
    reductionPercent: Number(
      response.data?.reductionPercent || 0
    )
  };
};
```

The bounded candidate is loaded through the authenticated `/api/explainer/source-range` endpoint in 2 MB pieces.

---

## 2. Current render entry point

Source: `lib/freeSplitExport.ts`.

```ts
export const renderSplitChunkLocally = async (
  projectId: string,
  sourceSize: number,
  start: number,
  duration: number,
  onProgress?: (percent: number) => void,
  onStatus?: (status: string) => void,
  audio?: LocalAudioConfig,
  renderMode:
    'preview' | 'original' | 'explainer' =
      audio ? 'explainer' : 'preview'
) => {
  if (!projectId || !sourceSize)
    throw new Error('source_required');

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error('split_chunk_invalid');
  }

  // Bounded extraction is supported for the first
  // 0:00–2:00 MP4 preview when the server proves
  // the file is prefix-preserving.
  if (
    renderMode === 'preview' &&
    !audio?.voiceBase64
  ) {
    try {
      const bounded =
        await loadBoundedCandidateForWindow(
          projectId,
          start,
          duration,
          onProgress,
          onStatus
        );

      const result =
        await renderBoundedPreviewLocally(
          bounded.candidate,
          duration,
          start,
          p => onProgress?.(
            Math.max(28, p)
          ),
          s => onStatus?.(s)
        );

      onStatus?.(
        `Bounded Web Preview ready — ${(
          bounded.bytes / 1024 / 1024
        ).toFixed(1)} MB of ${(
          sourceSize / 1024 / 1024
        ).toFixed(1)} MB entered the browser.`
      );

      return result.url;
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : String(error);

      onStatus?.(
        'Bounded preview unavailable (' +
        detail +
        '). Falling back to the existing full-source renderer…'
      );
    }
  }

  // Existing full-source FFmpeg path remains below.
  // It loads the entire source and encodes locally.
};
```

Important: any failure in the bounded path is swallowed into the compatibility fallback. Therefore Qwen must investigate whether the application is actually falling back to the **entire 70.7 MB source** after the bounded candidate fails.

---

## 3. Current direct native MP4 attempt

Source: `lib/freeSplitExport.ts`.

The current implementation attempts native browser playback before FFmpeg:

```ts
export const renderBoundedPreviewLocally = async (
  candidateSource: string | Uint8Array,
  duration: number,
  startSeconds = 0,
  onProgress?: (percent: number) => void,
  onStatus?: (status: string) => void
) => {
  if (!candidateSource)
    throw new Error('bounded_candidate_required');

  const source =
    candidateSource instanceof Uint8Array
      ? candidateSource
      : await (async () => {
          const response =
            await fetch(candidateSource);

          if (!response.ok)
            throw new Error(
              'bounded_candidate_download_failed:' +
              response.status
            );

          return new Uint8Array(
            await response.arrayBuffer()
          );
        })();

  if (source.byteLength < 1024)
    throw new Error('bounded_candidate_empty');

  const directUrl = URL.createObjectURL(
    new Blob(
      [source.slice().buffer],
      { type: 'video/mp4' }
    )
  );

  onProgress?.(30);

  onStatus?.(
    'Testing bounded MP4 directly in the browser — no re-encoding…'
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const video =
        document.createElement('video');

      video.preload = 'metadata';
      video.muted = true;

      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;

        window.clearTimeout(timer);

        video.removeAttribute('src');
        video.load();

        error
          ? reject(error)
          : resolve();
      };

      const timer =
        window.setTimeout(
          () => finish(
            new Error(
              'bounded_mp4_native_playback_timeout'
            )
          ),
          8000
        );

      video.onloadedmetadata =
        () => finish();

      video.oncanplay =
        () => finish();

      video.onerror =
        () => finish(
          new Error(
            'bounded_mp4_native_playback_failed'
          )
        );

      video.src = directUrl;
      video.load();
    });

    onProgress?.(100);

    onStatus?.(
      'Bounded Web Preview ready — native browser playback, no FFmpeg encode.'
    );

    return {
      url: directUrl,
      inputBytes: source.byteLength,
      outputBytes: source.byteLength,
      direct: true
    };
  } catch {
    URL.revokeObjectURL(directUrl);

    onStatus?.(
      'Native bounded MP4 playback was not accepted — using FFmpeg compatibility fallback…'
    );
  }

  // FFmpeg fallback follows.
};
```

The observed user result after this change is still failure/prolonged processing.

---

## 4. FFmpeg bounded fallback

If native playback fails, the same function does:

```ts
const ffmpeg = await getFFmpeg(onStatus);

const inputName =
  'reelforge-bounded-candidate.mp4';

const outputName =
  'reelforge-bounded-preview.mp4';

await ffmpeg.writeFile(
  inputName,
  source.slice()
);

const progressHandler =
  ({ progress }: { progress: number }) => {
    onProgress?.(
      30 +
      Math.min(
        65,
        Math.max(
          0,
          Math.round(progress * 65)
        )
      )
    );

    onStatus?.(
      'Encoding bounded Web Preview… ' +
      Math.round(progress * 100) +
      '%'
    );
  };

ffmpeg.on(
  'progress',
  progressHandler
);

await ffmpeg.exec([
  '-ss',
  String(Math.max(
    0,
    Number(startSeconds) || 0
  )),
  '-i',
  inputName,
  '-t',
  String(Math.max(1, duration)),
  '-map',
  '0:v:0',
  '-map',
  '0:a:0?',
  '-vf',
  'scale=640:-2',
  '-r',
  '20',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-crf',
  '34',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '96k',
  '-avoid_negative_ts',
  'make_zero',
  '-movflags',
  '+faststart',
  outputName
]);
```

The previous one-hour run reached approximately 30%, so the first hypothesis was that the browser was stuck in this FFmpeg stage.

However, the current direct-native path should bypass it if the candidate is a valid browser-playable MP4. Qwen must determine whether:

1. the native playback test is failing;
2. the candidate itself is structurally invalid;
3. the candidate is valid MP4 but not independently playable because its sample offsets/tables reference bytes outside the candidate;
4. the candidate is missing required metadata;
5. the candidate is not actually the candidate expected by the planner;
6. the code falls back to the full-source renderer.

---

# 5. Exact MP4 bounded planner

Source: `lib/mp4BoundedFeasibility.ts`.

The planner currently:

- requires `ftyp` at byte 0;
- requires `moov` in the first 16 MB inspection;
- supports only first-window `startSeconds === 0`;
- parses `trak → mdia → minf → stbl`;
- parses `mdhd`, `hdlr`, `stts`, `stsc`, `stsz`, `stco/co64`;
- maps the requested end time to a sample;
- maps that sample to a chunk;
- calculates a media byte boundary;
- returns a prefix candidate.

Core box parser:

```ts
type Box = {
  type: string;
  start: number;
  dataStart: number;
  end: number;
};

const u32 = (
  b: Uint8Array,
  o: number
) =>
  o + 4 <= b.length
    ? b[o] * 0x1000000 +
      (b[o + 1] << 16) +
      (b[o + 2] << 8) +
      b[o + 3]
    : 0;

const u64 = (
  b: Uint8Array,
  o: number
) =>
  o + 8 <= b.length
    ? u32(b, o) * 4294967296 +
      u32(b, o + 4)
    : 0;

const boxHeader = (
  b: Uint8Array,
  start: number,
  limit: number
): Box | null => {
  if (
    start + 8 > limit ||
    start + 8 > b.length
  ) return null;

  const size32 = u32(b, start);
  const type = text(
    b,
    start + 4,
    4
  );

  let header = 8;
  let size = size32;

  if (size32 === 1) {
    if (
      start + 16 > limit ||
      start + 16 > b.length
    ) return null;

    size = u64(
      b,
      start + 8
    );

    header = 16;
  } else if (size32 === 0) {
    size = limit - start;
  }

  if (
    !Number.isFinite(size) ||
    size < header
  ) return null;

  const end =
    Math.min(
      limit,
      start + size
    );

  if (
    end <= start + header
  ) return null;

  return {
    type,
    start,
    dataStart:
      start + header,
    end
  };
};
```

Track parsing:

```ts
const parseTrack = (
  b: Uint8Array,
  trak: Box
): TrackTable | null => {
  const mdia =
    child(b, trak, 'mdia');

  const mdhd =
    child(b, mdia, 'mdhd');

  const handler =
    child(b, mdia, 'hdlr');

  const stbl =
    path(
      b,
      mdia,
      ['minf', 'stbl']
    );

  if (
    !mdia ||
    !mdhd ||
    !handler ||
    !stbl
  ) return null;

  const handlerType =
    parseHandler(
      b,
      handler
    );

  const kind =
    handlerType === 'vide' ||
    handlerType === 'soun'
      ? handlerType
      : 'other';

  const timescale =
    parseMdhdTimescale(
      b,
      mdhd
    );

  const stts =
    child(b, stbl, 'stts');

  const stsc =
    child(b, stbl, 'stsc');

  const stsz =
    child(b, stbl, 'stsz');

  const stco =
    child(b, stbl, 'stco') ||
    child(b, stbl, 'co64');

  if (
    !timescale ||
    !stts ||
    !stsc ||
    !stco ||
    !stsz
  ) return null;

  const sizeInfo =
    parseStsz(
      b,
      stsz
    );

  return {
    kind,
    timescale,
    stts: parseStts(b, stts),
    stsc: parseStsc(b, stsc),
    chunkOffsets:
      parseChunkOffsets(
        b,
        stco
      ),
    sampleSize:
      sizeInfo.sampleSize,
    sampleSizes:
      sizeInfo.sampleSizes,
    sampleCount:
      sizeInfo.sampleCount
  };
};
```

Planner result:

```ts
const videoChunk =
  chunkForSample(
    video,
    sampleAtOrAfterTime(
      video,
      endSeconds
    )
  );

const audioChunk =
  audio
    ? chunkForSample(
        audio,
        sampleAtOrAfterTime(
          audio,
          endSeconds
        )
      )
    : null;

const videoBoundary =
  videoChunk.offset +
  videoChunk.size;

const audioBoundary =
  audioChunk
    ? audioChunk.offset +
      audioChunk.size
    : 0;

const requiredBytes =
  Math.min(
    sourceBytes,
    Math.max(
      moov.end,
      videoBoundary,
      audioBoundary
    )
  );
```

The planner calls this a:

```
prefix_preserving_candidate
```

Qwen must challenge this assumption. A byte prefix can only be independently playable if every required referenced byte and every required index/offset remains inside that prefix and the MP4 structure is valid for truncated playback.

---

# 6. Exact current backend bounded-source-plan route

Source: `backend/index.ts`, current AppDeploy snapshot `1791031272689`.

The MP4 branch is:

```ts
'POST /api/explainer/bounded-source-plan':
[
  requireAuth(),
  async ({body,user}) => {
    const x = (body || {}) as {
      projectId?: string;
      startSeconds?: number;
      endSeconds?: number
    };

    const projectId =
      String(x.projectId || '');

    if (!projectId)
      return json({
        error:
          'explainer_project_required'
      }, 400);

    const [p] =
      await db.get(
        PROJECTS,
        [projectId]
      );

    if (
      !p ||
      p.workspaceId !==
        userWorkspace(user!)
    ) {
      return json({
        error:
          'explainer_project_not_found'
      }, 404);
    }

    const start =
      Math.max(
        0,
        Number(
          x.startSeconds ?? 0
        )
      );

    const end =
      Math.max(
        start + 0.1,
        Number(
          x.endSeconds ?? 120
        )
      );

    const sourceBytes =
      Number(
        p.explainerSourceSize || 0
      );

    const sourceName =
      String(
        p.explainerSourceName || ''
      );

    const isMp4 =
      /\.mp4$/i.test(sourceName) ||
      /mp4/i.test(
        String(
          p.explainerSourceMime || ''
        )
      );

    if (isMp4) {
      if (
        start !== 0 ||
        end > 120
      ) {
        return json({
          error:
            'mp4_middle_window_not_yet_prefix_preserving',
          sourceBytes,
          startSeconds: start,
          endSeconds: end
        }, 409);
      }

      const chunkSize =
        4 * 1024 * 1024;

      const total =
        Number(
          p.explainerSourceChunkTotal ||
          0
        );

      const prefix =
        String(
          p.explainerSourceChunkPrefix ||
          ''
        );

      const inspectBytes =
        Math.min(
          sourceBytes,
          16 * 1024 * 1024
        );

      const inspectCount =
        Math.ceil(
          inspectBytes /
          chunkSize
        );

      const paths =
        Array.from(
          {length: inspectCount},
          (_, i) =>
            prefix +
            i +
            '.part'
        );

      const files =
        await storage.read(
          paths
        );

      const byPath =
        new Map(
          files.map(
            file => [
              file.path,
              typeof file.content ===
                'string'
                ? file.content
                : ''
            ]
          )
        );

      const assembled =
        new Uint8Array(
          inspectBytes
        );

      let cursor = 0;

      for (
        let i = 0;
        i < inspectCount;
        i++
      ) {
        const raw =
          byPath.get(
            paths[i]
          );

        if (!raw)
          return json({
            error:
              'mp4_bounded_inspection_chunk_missing',
            chunk: i
          }, 409);

        const bytes =
          base64ToUint8Array(
            raw
          );

        const expected =
          expectedChunkBytes(
            sourceBytes,
            total,
            i
          );

        const copy =
          Math.min(
            bytes.byteLength,
            inspectBytes - cursor
          );

        if (
          bytes.byteLength !==
            expected &&
          i < inspectCount - 1
        ) {
          return json({
            error:
              'mp4_bounded_inspection_chunk_invalid',
            chunk: i,
            expectedBytes:
              expected,
            receivedBytes:
              bytes.byteLength
          }, 409);
        }

        assembled.set(
          bytes.subarray(
            0,
            copy
          ),
          cursor
        );

        cursor += copy;

        if (
          cursor >=
          inspectBytes
        ) break;
      }

      const plan =
        analyzeMp4BoundedPrefix(
          assembled,
          sourceBytes,
          start,
          end
        );

      const maxBytes =
        45 * 1024 * 1024;

      if (!plan.ok)
        return json({
          error:
            plan.reason ||
            'mp4_bounded_plan_unavailable',
          ...plan
        }, 409);

      return json({
        ok: true,
        projectId,
        startSeconds: start,
        endSeconds: end,
        requiredBytes:
          plan.requiredBytes,
        mediaBytes:
          plan.mediaBytes,
        initializationBytes:
          plan.initializationBytes,
        sourceBytes,
        byteStart: 0,
        byteEnd:
          plan.requiredBytes,
        reductionPercent:
          plan.reductionPercent,
        videoBoundary:
          plan.videoBoundary,
        audioBoundary:
          plan.audioBoundary,
        moovOffset:
          plan.moovOffset,
        moovEnd:
          plan.moovEnd,
        guardrailBytes:
          maxBytes,
        withinGuardrail:
          plan.requiredBytes <=
          maxBytes,
        validity:
          plan.validity,
        planner:
          'mp4-sample-tables'
      });
    }

    // Existing Matroska path remains unchanged.
  }
],
```

---

# 7. Base64 storage representation

The current backend defines:

```ts
const base64ToUint8Array =
  (base64: string) => {
    const binary =
      atob(base64);

    const bytes =
      new Uint8Array(
        binary.length
      );

    for (
      let i = 0;
      i < binary.length;
      i++
    ) {
      bytes[i] =
        binary.charCodeAt(i);
    }

    return bytes;
  };
```

Upload also stores the incoming base64 string directly:

```ts
const data =
  String(x.data);

const decoded =
  base64ToUint8Array(data);

const expectedBytes =
  expectedChunkBytes(
    size,
    total,
    index
  );

if (
  decoded.byteLength !==
  expectedBytes
)
  return json({
    error:
      'explainer_chunk_byte_length_invalid',
    index,
    expectedBytes,
    receivedBytes:
      decoded.byteLength
  }, 409);

const computedSha256 =
  await sha256Hex(
    decoded
  );

if (
  x.chunkSha256 &&
  String(
    x.chunkSha256
  ).toLowerCase() !==
    computedSha256
)
  return json({
    error:
      'explainer_chunk_hash_mismatch',
    index
  }, 409);
```

Therefore the storage representation should be raw MP4 bytes encoded as base64 text, but Qwen should verify this rather than assuming it.

---

# 8. Known source integrity evidence

The application previously reported:

- SOURCE_READY
- 18/18 chunks verified
- 74,165,709 / 74,165,709 bytes
- no known chunk corruption.

The source is therefore not currently believed to be incomplete.

---

# 9. What happened in testing

### Before bounded MP4 planner

The browser could spend a very long time trying to render the full 70.7 MB source.

### After bounded MP4 planner

The frontend was changed to request a bounded prefix for Chunk 01.

### After direct-native preview change

The browser first creates a Blob URL from the bounded MP4 and waits up to 8 seconds for:

- `loadedmetadata`, or
- `canplay`.

If that fails, it falls back to FFmpeg.

### Actual user observation

The user reported:

> “same thing, now let get back to qwen 3.8max…”

after the direct-native change.

The previous observed long run:

- approximately 1 hour;
- progress reached approximately 30%;
- then local chunk render failed.

This strongly suggests that the bounded candidate is either not independently playable or the bounded path is failing and silently falling back.

---

# Questions for Qwen 3.8 Max

Act as a senior browser-media + ISO BMFF/MP4 engineer.

Analyze the **exact code above**. Do not answer with generic MP4 advice.

## Primary questions

1. Is the current `prefix_preserving_candidate` assumption actually valid?
2. Can an MP4 be made playable by simply truncating at a calculated sample/chunk boundary?
3. If `stco/co64` contains absolute file offsets into `mdat`, does the candidate remain valid when the candidate contains only the beginning of the original file?
4. Does `stsz + stsc + stts` give enough information to determine an independently playable prefix?
5. Does the candidate need the complete `moov` box even when only the first 2 minutes are wanted?
6. Could `stss`/keyframe alignment matter?
7. Could `ctts`, edit lists (`edts/elst`), `sgpd/sbgp`, `sdtp`, or other boxes matter?
8. What happens if the audio track has samples interleaved after the video boundary?
9. What happens if video and audio chunks are not ordered the way the planner assumes?
10. Is `requiredBytes = max(moovEnd, videoBoundary, audioBoundary)` sufficient?
11. Does the candidate need to contain an entire `mdat` box rather than merely enough bytes for the selected samples?
12. What happens when the original `mdat` box declares a size larger than the candidate?
13. Could Chrome reject the Blob because the MP4 container is physically truncated even though all desired samples are present?
14. Does `moov` contain chunk offsets that reference bytes beyond the candidate, causing browser validation to fail?
15. Does the native `loadedmetadata/canplay` test actually prove the candidate is playable?
16. Is 8 seconds enough to distinguish invalid MP4 from slow browser parsing?
17. Is the current fallback masking the real bounded candidate failure?

## Critical request

Do not simply recommend more logging.

Design a diagnostic endpoint that reads only the **existing permanent chunks** and returns structural evidence such as:

- source first four bytes;
- top-level MP4 boxes;
- exact `ftyp` range;
- exact `moov` range;
- exact `mdat` ranges;
- movie timescale/duration;
- track IDs;
- handler types;
- video/audio timescales;
- sample counts;
- `stts` duration;
- `stsc` entries;
- `stsz` mode;
- `stco/co64` ranges;
- first/last chunk offsets;
- first/last sample offsets;
- keyframe information if `stss` exists;
- edit list information if present;
- whether any referenced sample lies outside the proposed candidate;
- whether the proposed candidate ends inside an `mdat` box;
- whether the candidate would leave a top-level `mdat` with an invalid declared size.

Return no actual video data.

## Most important desired outcome

Determine whether the right solution is:

### A. True prefix extraction

The current prefix is actually independently playable and only the implementation is wrong.

### B. MP4 remux/rewrite

The source needs a server-side bounded MP4 rewrite/remux that:

- copies only the first 2 minutes;
- rewrites `moov`;
- patches `stco/co64`;
- creates a valid `mdat`;
- preserves video/audio;
- produces a small standalone MP4.

### C. Browser-native range playback

The candidate approach is unnecessary and the browser should instead receive byte ranges from the original MP4 through a server endpoint supporting HTTP Range semantics.

### D. Another architecture

If another approach is technically superior, explain exactly why.

Do not recommend JSON2Video.

Do not require a new upload.

Do not remove permanent chunks.

Do not remove SourceMaster.

Do not remove local/browser MP4 export.

---

# Required response format from Qwen

Return exactly these sections:

## 1. Root cause

State the most likely root cause and confidence level.

## 2. Evidence from supplied code

Quote the exact code behavior that proves your conclusion.

## 3. MP4 structural issue

Explain the ISO BMFF/container reason.

## 4. Diagnostic patch

Provide concrete TypeScript for a safe structural diagnostic endpoint.

## 5. Correct production solution

Provide concrete TypeScript implementation, not pseudocode.

## 6. Unit tests

Provide focused fixtures/tests.

## 7. AppDeploy patch plan

List exact files/functions to change.

## 8. What NOT to change

Explicitly preserve the existing ReelForge architecture.

## 9. Validation procedure

Give a short test procedure for Chunk 01 that can prove whether the fix works.

---

# Final instruction to Qwen

Do not assume the earlier Qwen analysis of `mp4_duration_not_found` was correct.

This is a new downstream failure.

The duration issue is already sufficiently solved because Full Video Split now successfully produces:

- Chunk 01: 0:00 → 2:00
- Chunk 02: 2:00 → 4:00
- etc.

The current problem is:

**Why does the first bounded MP4 candidate fail to become a fast, independently playable browser preview?**

Analyze the supplied production code and solve that exact problem.
