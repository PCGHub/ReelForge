import { api } from '@appdeploy/client';

let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;
const sourceCache = new Map<string, Promise<Uint8Array>>();
const SOURCE_DB_NAME = 'reelforge-local-source-cache';
const SOURCE_DB_VERSION = 1;
const SOURCE_STORE = 'ranges';
const SOURCE_RANGE_SIZE = 2 * 1024 * 1024;

const openSourceDb = (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(SOURCE_DB_NAME, SOURCE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SOURCE_STORE)) db.createObjectStore(SOURCE_STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
};

const sourceRangeKey = (projectId: string, sourceSize: number, offset: number) => projectId + ':' + sourceSize + ':' + offset;

const readCachedRange = async (projectId: string, sourceSize: number, offset: number): Promise<Uint8Array | null> => {
  const db = await openSourceDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(SOURCE_STORE, 'readonly').objectStore(SOURCE_STORE).get(sourceRangeKey(projectId, sourceSize, offset));
      request.onsuccess = () => {
        const value = request.result;
        resolve(value?.data instanceof ArrayBuffer ? new Uint8Array(value.data) : null);
      };
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
};

const writeCachedRange = async (projectId: string, sourceSize: number, offset: number, bytes: Uint8Array) => {
  const db = await openSourceDb();
  if (!db) return;
  try {
    await new Promise<void>(resolve => {
      const tx = db.transaction(SOURCE_STORE, 'readwrite');
      tx.objectStore(SOURCE_STORE).put({ key: sourceRangeKey(projectId, sourceSize, offset), projectId, sourceSize, offset, data: bytes.slice().buffer });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {}
};

const readPersistentSource = async (projectId: string, sourceSize: number, onProgress?: (percent: number) => void, onStatus?: (status: string) => void): Promise<Uint8Array | null> => {
  const total = Math.max(1, Number(sourceSize) || 0);
  const source = new Uint8Array(total);
  let found = 0;
  for (let offset = 0; offset < total; offset += SOURCE_RANGE_SIZE) {
    const size = Math.min(SOURCE_RANGE_SIZE, total - offset);
    const bytes = await readCachedRange(projectId, sourceSize, offset);
    if (!bytes || bytes.byteLength !== size) return null;
    source.set(bytes, offset);
    found += bytes.byteLength;
    onProgress?.(Math.min(35, Math.round((found / total) * 35)));
  }
  onStatus?.('Source restored from this browser — no server download needed.');
  return source;
};
type LocalAudioConfig = { mode: 'original' | 'voice' | 'mix'; originalVolume: number; voiceVolume: number; autoDuck: boolean; voiceBase64: string };

const getFFmpeg = async (onStatus?: (status: string) => void) => {
  if (typeof window === 'undefined') throw new Error('browser_only');
  if (!ffmpegPromise) {
    ffmpegPromise = import('@ffmpeg/ffmpeg').then(async ({ FFmpeg }) => {
      const { toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
      onStatus?.('Loading the free browser video engine…');
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript')
      });
      return ffmpeg;
    });
  }
  return ffmpegPromise;
};

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const loadSourceRange = async (
  projectId: string,
  offset: number,
  size: number,
  onStatus?: (status: string) => void
) => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await api.post('/api/explainer/source-range', { projectId, offset, size });
      const data = String(response.data?.data || '');
      if (!data) throw new Error('source_range_empty');
      const bytes = decodeBase64(data);
      const returnedSize = Number(response.data?.size || bytes.byteLength);
      if (bytes.byteLength !== returnedSize || bytes.byteLength > size) {
        throw new Error(`source_range_size_mismatch:${bytes.byteLength}/${returnedSize}`);
      }
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        onStatus?.(`Network hiccup while loading source (${attempt}/3) — retrying…`);
        await new Promise(resolve => window.setTimeout(resolve, 700 * attempt));
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : 'network_request_failed';
  throw new Error(`source_range_network_failed_at_${offset}:${detail}`);
};

const loadSourceIntoBrowser = async (
  projectId: string,
  sourceSize: number,
  onProgress?: (percent: number) => void,
  onStatus?: (status: string) => void
) => {
  const cacheKey = `${projectId}:${sourceSize}`;
  const cached = sourceCache.get(cacheKey);
  if (cached) {
    onProgress?.(35);
    onStatus?.('Source already loaded in this browser session.');
    return cached;
  }

  const total = Math.max(1, Number(sourceSize) || 0);
  const loadPromise = (async () => {
    const persistent = await readPersistentSource(projectId, sourceSize, onProgress, onStatus);
    if (persistent) return persistent;

    const source = new Uint8Array(total);
    const response = await api.get('/api/explainer/source-chunks?projectId=' + encodeURIComponent(projectId));
    const chunks = Array.isArray(response.data?.chunks) ? response.data.chunks as Array<{index:number;url:string;path:string}> : [];
    if (!chunks.length) throw new Error('source_chunk_urls_unavailable');
    const ordered = [...chunks].sort((a,b) => a.index - b.index);
    if (ordered.length !== Math.ceil(total / (4 * 1024 * 1024))) throw new Error('source_chunk_count_mismatch');
    let nextIndex = 0;
    let written = 0;
    const worker = async () => {
      while (true) {
        const position = nextIndex++;
        if (position >= ordered.length) return;
        const chunk = ordered[position];
        const response = await fetch(chunk.url);
        if (!response.ok) throw new Error('source_chunk_fetch_failed:' + response.status);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const offset = chunk.index * 4 * 1024 * 1024;
        const expected = Math.min(4 * 1024 * 1024, total - offset);
        if (bytes.byteLength !== expected) throw new Error('source_chunk_size_mismatch:' + chunk.index + ':' + bytes.byteLength + '/' + expected);
        source.set(bytes, offset);
        await writeCachedRange(projectId, sourceSize, offset, bytes);
        written += bytes.byteLength;
        onProgress?.(Math.min(35, Math.round((written / total) * 35)));
        onStatus?.('Caching source locally… ' + Math.round((written / total) * 100) + '%');
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ordered.length) }, () => worker()));
    if (written !== total) throw new Error('source_download_incomplete');
    onStatus?.('Source cached locally for future chunks and sessions.');
    return source;
  })();

  sourceCache.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } catch (error) {
    sourceCache.delete(cacheKey);
    throw error;
  }
};

const loadBoundedCandidateForWindow = async (projectId: string, start: number, duration: number, onProgress?: (percent: number) => void, onStatus?: (status: string) => void) => {
  const end = start + duration;
  const response = await api.post('/api/explainer/bounded-source-plan', { projectId, startSeconds: start, endSeconds: end });
  const bytes = Number(response.data?.requiredBytes || 0);
  const sourceBytes = Number(response.data?.sourceBytes || 0);
  if (!bytes || !sourceBytes) throw new Error('bounded_candidate_plan_unavailable');
  if (!Boolean(response.data?.withinGuardrail)) throw new Error('bounded_candidate_guardrail_exceeded:' + (bytes / 1024 / 1024).toFixed(1) + 'MB/' + (sourceBytes / 1024 / 1024).toFixed(1) + 'MB');
  onStatus?.(`Loading bounded prefix: ${(bytes / 1024 / 1024).toFixed(1)} MB instead of ${(sourceBytes / 1024 / 1024).toFixed(1)} MB…`);
  const candidate = new Uint8Array(bytes);
  let offset = 0;
  while (offset < bytes) {
    const size = Math.min(2 * 1024 * 1024, bytes - offset);