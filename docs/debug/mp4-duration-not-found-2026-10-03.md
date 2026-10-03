# ReelForge Full Video Split — MP4 Duration Failure Investigation

Date: 2026-10-03

## Objective

Investigate and solve the persistent `mp4_duration_not_found` failure in ReelForge Explainer Studio > Full Video Split.

This document is an evidence bundle extracted from the live AppDeploy source for app `reelforge-ykctrq`.

- AppDeploy app ID: `reelforge-ykctrq`
- AppDeploy snapshot: `1790966432675`
- Live app: https://reelforge-ykctrq.v2.appdeploy.ai/
- GitHub repository: `PCGHub/ReelForge`
- Current production error shown to user: `mp4_duration_not_found`

## Affected user flow

1. Open Explainer Studio.
2. Open project `india whisky`.
3. Source file:
   `Srinivas-Bellamkonda-Best-Action-Scenes_-_.mp4`
4. Source size: approximately 70.7 MB.
5. Source diagnostics previously showed:
   - `SOURCE_READY`
   - 18/18 permanent chunks verified.
   - 74,165,709 / 74,165,709 bytes verified.
6. Select **Full Video Split**.
7. Choose a split duration such as 60 seconds or 2 minutes.
8. Click **Generate full video chunks**.
9. The duration discovery path reaches:
   `POST /api/explainer/source-duration`
10. The endpoint returns:
   `{"error":"mp4_duration_not_found"}`
11. The frontend surfaces that exact error.

No re-upload should be required unless a fresh integrity check proves the permanent chunks are corrupt. The source is intended to remain authoritative in the permanent 4 MB chunk store.

## Failure history

Earlier attempts included:

- Browser MediaInfo metadata read.
- Browser fetching first/last permanent chunks.
- Backend MP4 duration extraction.
- Sequential backend scanning of all permanent chunks.
- MP4 timing-box support for `mvhd`, `mdhd`, `tkhd`, and `mehd`.
- Fixing an earlier caller/parser mismatch where `parse()` returned an object but the caller treated it as a number.
- Correcting MP4 version-1 timing offsets:
  - Version 0: timescale +16, duration +20 for `mvhd/mdhd`.
  - Version 1: timescale +24, 64-bit duration +28 for `mvhd/mdhd`.

Despite those changes, the live application still reports `mp4_duration_not_found`.

## Important architecture constraints

Do NOT redesign ReelForge or remove existing architecture.

Preserve:

- Permanent 4 MB source chunks.
- SourceMaster / server-owned source lifecycle.
- Source integrity verification.
- Intelligent Discovery.
- Transcript/explainer pipeline.
- ElevenLabs/audio integration.
- Browser/local MP4 export.
- Existing browser FFmpeg fallback unless a replacement is proven.
- JSON2Video-free Full Video Split rendering.

The task is specifically to make MP4 duration discovery reliable for Full Video Split.

---

# Exact AppDeploy backend code

Source: `backend/index.ts`, AppDeploy snapshot `1790966432675`.

The relevant production endpoint is:

```ts
'POST /api/explainer/source-duration':[requireAuth(),async({body,user})=>{
 const x=(body||{}) as {projectId?:string};
 const projectId=String(x.projectId||'');
 if(!projectId)return json({error:'explainer_project_required'},400);

 const [p]=await db.get(PROJECTS,[projectId]);
 if(!p||p.workspaceId!==userWorkspace(user!))
   return json({error:'explainer_project_not_found'},404);

 const sourceName=String(p.explainerSourceName||'').toLowerCase();
 const mime=String(p.explainerSourceMime||'').toLowerCase();

 if(!sourceName.endsWith('.mp4')&&!mime.includes('mp4'))
   return json({error:'mp4_duration_parser_not_applicable'},422);

 const total=Number(p.explainerSourceChunkTotal||0);
 const prefix=String(p.explainerSourceChunkPrefix||'');

 if(!total||!prefix)
   return json({error:'explainer_source_chunks_unavailable'},409);

 try{
   const parse=(bytes:Uint8Array)=>{
     const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
     let movieTimescale=0;
     let bestDuration=0;

     const hits:Array<{
       type:string;
       version:number;
       offset:number;
       timescale:number;
       duration:number
     }> = [];

     const readU64=(offset:number)=>
       view.getUint32(offset,false)*4294967296+
       view.getUint32(offset+4,false);

     for(let i=0;i+8<=bytes.byteLength;i++){
       const type=String.fromCharCode(
         bytes[i],bytes[i+1],bytes[i+2],bytes[i+3]
       );

       if(type!=='mvhd'&&type!=='mdhd'&&type!=='tkhd'&&type!=='mehd')
         continue;

       const version=bytes[i+4]??255;
       let timescale=0,duration=0;

       if(type==='mvhd'){
         if(version===0&&i+24<=bytes.byteLength){
           timescale=view.getUint32(i+16,false);
           duration=view.getUint32(i+20,false);
           if(timescale>0)movieTimescale=timescale;
         }else if(version===1&&i+36<=bytes.byteLength){
           timescale=view.getUint32(i+24,false);
           duration=readU64(i+28);
           if(timescale>0)movieTimescale=timescale;
         }
       }else if(type==='mdhd'){
         if(version===0&&i+24<=bytes.byteLength){
           timescale=view.getUint32(i+16,false);
           duration=view.getUint32(i+20,false);
         }else if(version===1&&i+36<=bytes.byteLength){
           timescale=view.getUint32(i+24,false);
           duration=readU64(i+28);
         }
       }else if(type==='tkhd'){
         if(version===0&&i+28<=bytes.byteLength)
           duration=view.getUint32(i+24,false);
         else if(version===1&&i+40<=bytes.byteLength)
           duration=readU64(i+32);

         timescale=movieTimescale;
       }else if(type==='mehd'){
         if(version===0&&i+12<=bytes.byteLength)
           duration=view.getUint32(i+8,false);
         else if(version===1&&i+16<=bytes.byteLength)
           duration=readU64(i+8);

         timescale=movieTimescale;
       }

       if(hits.length<24)
         hits.push({type,version,offset:i,timescale,duration});

       if(timescale>0&&duration>0){
         const seconds=duration/timescale;

         if(Number.isFinite(seconds)&&seconds>bestDuration)
           bestDuration=seconds;
       }
     }

     return {duration:bestDuration,hits};
   };

   let carry=new Uint8Array(0);

   for(let index=0;index<total;index++){
     const path=prefix+index+'.part';
     const files=await storage.read([path]);
     const content=typeof files[0]?.content==='string'
       ?files[0].content
       :'';

     if(!content)
       throw new Error('explainer_source_chunk_missing_'+index);

     const current=base64ToUint8Array(content);

     const combined=new Uint8Array(
       carry.length+current.length
     );

     combined.set(carry,0);
     combined.set(current,carry.length);

     const parsed=parse(combined);
     const duration=parsed.duration;

     if(Number.isFinite(duration)&&duration>0){
       return json({
         projectId,
         duration,
         sourceDuration:duration,
         container:'mp4',
         method:'sequential_permanent_chunk_scan',
         chunksScanned:index+1
       });
     }

     carry=current.slice(
       Math.max(0,current.length-128)
     );
   }

   return json({error:'mp4_duration_not_found'},422);

 }catch(e){
   return json({
     error:'explainer_source_duration_failed',
     message:e instanceof Error?e.message:String(e)
   },502);
 }
}],
```

## Exact production frontend duration code

Source: `components/ExplainerStudio.tsx`, AppDeploy snapshot `1790966432675`.

Relevant function:

```ts
const getSourceDuration=async(p:Project)=>{
 const existing=Number(
   p.explainerSourceDuration||p.sourceDuration||0
 );

 if(existing>0)return existing;

 const persistedChunks=Array.isArray(p.splitChunks)
   ?p.splitChunks as SplitChunk[]
   :[];

 const persistedEnd=persistedChunks.reduce(
   (max,c)=>Math.max(max,Number(c.end)||0),
   0
 );

 if(persistedEnd>0){
   const rounded=Math.max(.1,persistedEnd);
   const next={
     ...p,
     sourceDuration:rounded,
     explainerSourceDuration:rounded
   };

   setActive(x=>x&&x.id===p.id?{...x,...next}:x);
   setProjects(x=>x.map(v=>v.id===p.id?{...v,...next}:v));
   setStage('Using the existing verified split timeline…');
   setSplitProgress(45);
   return rounded;
 }

 const fileSize=Number(p.sourceSize||0);
 if(!fileSize)throw new Error('source_size_unavailable');

 setStage('Reading MP4 duration from permanent chunks…');
 setSplitProgress(30);

 const isMp4=/\\.mp4$/i.test(String(p.sourceName||''))||
   /mp4/i.test(
     String(
       (p as Project & {
         sourceMime?:string;
         explainerSourceMime?:string
       }).sourceMime||
       (p as Project & {
         explainerSourceMime?:string
       }).explainerSourceMime||
       ''
     )
   );

 if(isMp4){
   try{
     const direct=await api.post(
       '/api/explainer/source-duration',
       {projectId:p.id}
     );

     const directDuration=Number(
       direct.data?.duration||0
     );

     if(
       Number.isFinite(directDuration)&&
       directDuration>0
     ){
       const next={
         ...p,
         sourceDuration:directDuration,
         explainerSourceDuration:directDuration
       };

       setActive(x=>x&&x.id===p.id?{...x,...next}:x);
       setProjects(x=>x.map(v=>v.id===p.id?{...v,...next}:v));
       setSplitProgress(60);

       return directDuration;
     }

     throw new Error(
       String(
         direct.data?.error||
         'mp4_duration_unavailable'
       )
     );

   }catch(e){
     const err=e as {
       response?:{
         data?:{
           error?:string;
           message?:string
         }
       }
     };

     throw new Error(
       String(
         err?.response?.data?.error||
         err?.response?.data?.message||
         (e instanceof Error
           ?e.message
           :'mp4_duration_unavailable')
       )
     );
   }
 }

 // Older browser MediaInfo fallback remains below
 // for non-MP4 / legacy paths.
};
```

The live code also contains an older browser MediaInfo path after this MP4 branch, but the MP4 branch intentionally throws instead of falling back to MediaInfo when the server parser returns no duration.

## Split-plan dependency

The Full Video Split timeline requires a positive source duration:

```ts
'POST /api/explainer/split-plan':[requireAuth(),async({body,user})=>{
 const x=(body||{}) as {
   projectId?:string;
   chunkDuration?:number;
   sourceDuration?:number
 };

 if(!x.projectId)
   return json({error:'explainer_project_required'},400);

 const [p]=await db.get(PROJECTS,[x.projectId]);

 if(!p||p.workspaceId!==userWorkspace(user!))
   return json({error:'explainer_project_not_found'},404);

 const duration=Number(
   x.sourceDuration||p.explainerSourceDuration||0
 );

 const chunkDuration=Math.max(
   10,
   Math.min(
     600,
     Number(x.chunkDuration)||120
   )
 );

 if(!Number.isFinite(duration)||duration<=0)
   return json({
     error:'explainer_source_duration_required'
   },400);

 const chunks=Array.from(
   {length:Math.ceil(duration/chunkDuration)},
   (_,i)=>{
     const start=i*chunkDuration;
     const end=Math.min(
       duration,
       (i+1)*chunkDuration
     );

     return {
       id:'split-'+String(i+1),
       index:i+1,
       start,
       end,
       duration:end-start
     };
   }
 );

 // ...
}],
```

---

# Suspected problem areas to investigate

We need a root-cause analysis, not another speculative offset patch.

Please investigate at least these possibilities:

### 1. The source may not contain timing metadata in the first 4 MB

The current scanner examines every permanent chunk sequentially, so this should not matter unless the MP4 metadata is stored in an unexpected structure or the bytes being returned by `storage.read()` are not the original binary bytes.

### 2. Base64 decoding may not return the original bytes

The source chunks are stored as base64 text.

The parser depends on:

```ts
base64ToUint8Array(content)
```

Verify the implementation of `base64ToUint8Array` and confirm that it correctly handles the actual storage representation.

This is a particularly important investigation target.

### 3. MP4 box parsing is too naive

The parser currently scans raw bytes for ASCII strings:

```
mvhd
mdhd
tkhd
mehd
```

It does not parse MP4 box lengths/types hierarchically.

Investigate whether:

- the MP4 uses a non-standard/fragmented structure;
- the timing boxes are fragmented across chunk boundaries;
- the current 128-byte carry is sufficient;
- the box type can be found but offsets are calculated from the wrong origin;
- extended-size boxes (`size === 1`) affect interpretation;
- `uuid` boxes or other container structures matter;
- the file is fragmented MP4 (`moof/mdat`) with duration in `mvex/mehd` or fragment timing rather than a traditional `mvhd`;
- there are multiple `mdhd` boxes with different timescales and the current selection logic is incorrect.

### 4. Version/offset interpretation

Verify the exact ISO Base Media File Format box layout for:

- `mvhd` version 0
- `mvhd` version 1
- `mdhd` version 0
- `mdhd` version 1
- `tkhd` version 0
- `tkhd` version 1
- `mehd` version 0
- `mehd` version 1

Do not assume the offsets in the current implementation are correct merely because they are plausible.

### 5. Need for diagnostic evidence

The current endpoint collects:

```ts
const hits=[]
```

but does not return the hits when parsing fails.

A robust debugging patch may need to return or persist diagnostic evidence such as:

- chunks scanned;
- bytes scanned;
- first four bytes;
- MP4 `ftyp` location;
- `moov` location;
- `moov` size;
- `mvhd` locations;
- `mdhd` locations;
- `tkhd` locations;
- `mehd` locations;
- parsed version;
- raw timescale;
- raw duration;
- calculated seconds;
- detected `moof` boxes;
- detected `tfdt` boxes;
- detected `trun` boxes;
- whether any timing metadata exists;
- exact reason no valid duration was accepted.

### 6. Need to inspect the actual source bytes

If the available GitHub/AppDeploy environment cannot access the private storage bytes, propose a safe diagnostic endpoint that reads only the first small bounded portion of the permanent chunks and returns non-sensitive structural metadata, not the video itself.

Do NOT require the user to re-upload the 70.7 MB source.

---

# Desired solution characteristics

We need a production-safe fix that:

1. Reliably obtains duration from the existing permanent chunks.
2. Does not reconstruct the entire source in the browser.
3. Does not require JSON2Video.
4. Does not require ElevenLabs.
5. Does not require a new upload.
6. Works across normal MP4 and fragmented MP4 where possible.
7. Has bounded memory usage.
8. Gives a meaningful diagnostic error when unsupported rather than generic `mp4_duration_not_found`.
9. Preserves the existing Full Video Split and local FFmpeg export architecture.
10. Includes a focused automated/unit test for the parser.
11. Ideally tests against a small synthetic MP4 fixture representing the detected structure.

# What Qwen 3.8 Max should return

Please act as a senior media-container/TypeScript engineer.

Analyze the exact code above and identify the most likely root cause of `mp4_duration_not_found`.

Then provide:

1. Root-cause explanation.
2. Specific evidence in the code supporting that conclusion.
3. A corrected implementation.
4. A diagnostic version that exposes enough evidence to prove why the current source fails.
5. Unit tests for the parser.
6. Any required AppDeploy changes.
7. A minimal patch plan that changes only what is necessary.
8. Explicitly state whether the current 128-byte carry is sufficient and why.
9. Explicitly state whether the problem is likely parser logic, base64 decoding, storage representation, fragmented MP4 structure, or another issue.
10. If more evidence is required, specify the smallest safe diagnostic data needed from the existing permanent chunks.

Do not redesign ReelForge.

Do not suggest re-uploading the source as the first step.

Do not replace the working permanent-chunk architecture.

Do not assume MediaInfo will work in the browser; the previous implementation already encountered metadata-read timeouts.

The objective is to solve the actual `mp4_duration_not_found` failure in the existing production architecture.
