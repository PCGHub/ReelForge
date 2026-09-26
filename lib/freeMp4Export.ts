let ffmpegPromise: Promise<import('@ffmpeg/ffmpeg').FFmpeg> | null = null;

const getFFmpeg = async () => {
  if (typeof window === 'undefined') throw new Error('browser_only');
  if (!ffmpegPromise) {
    ffmpegPromise = import('@ffmpeg/ffmpeg').then(async ({ FFmpeg }) => {
      const { toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
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

export const convertWebmToMp4 = async (webmUrl: string, onProgress?: (percent: number) => void, onStatus?: (status: string) => void) => {
  if (!webmUrl) throw new Error('webm_required');
  onProgress?.(5); onStatus?.('Loading the free MP4 converter…');
  const ffmpeg = await getFFmpeg();
  onProgress?.(15); onStatus?.('Converter ready. Downloading your WebM preview…');
  const response = await fetch(webmUrl);
  if (!response.ok) throw new Error(`webm_fetch_${response.status}`);
  const input = new Uint8Array(await response.arrayBuffer());
  if (input.length < 1024) throw new Error('webm_input_empty');
  onProgress?.(25); onStatus?.('WebM loaded. Preparing device-side conversion…');

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.max(30, Math.min(98, 30 + Math.round(progress * 68))));
    onStatus?.(progress > 0 ? `Converting on this device… ${Math.round(progress * 100)}%` : 'Conversion started — encoding on this device…');
  };

  ffmpeg.on('progress', progressHandler);
  try {
    onStatus?.('Writing WebM into the local converter…');
    await ffmpeg.writeFile('input.webm', input);
    onProgress?.(30);
    onStatus?.('Encoding MP4 locally. This can take a few minutes on mobile…');
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4'
    ]);
    const output = await ffmpeg.readFile('output.mp4');
    const bytes = output instanceof Uint8Array ? output : new TextEncoder().encode(output);
    if (!bytes.length) throw new Error('mp4_output_empty');
    const mp4Buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    onProgress?.(100); onStatus?.('MP4 conversion complete. Ready to download.');
    return URL.createObjectURL(new Blob([mp4Buffer], { type: 'video/mp4' }));
  } finally {
    ffmpeg.off('progress', progressHandler);
    try { await ffmpeg.deleteFile('input.webm'); } catch {}
    try { await ffmpeg.deleteFile('output.mp4'); } catch {}
  }
};
