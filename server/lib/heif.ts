import crypto from 'crypto';
import path from 'path';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import sharp from 'sharp';
import { ROOT_PATH } from '@shared/lib/pathConstant';

/**
 * Preview support for HEIF/HEIC images (the default photo format on iOS and many
 * Android cameras).
 *
 * sharp's prebuilt libvips only bundles the AV1 half of libheif, so HEVC-coded
 * `.heic` files - which is what phones actually write - fail with "Input buffer
 * contains unsupported image format". We decode those with libheif-js (libheif
 * compiled to JavaScript) and re-encode a browser friendly JPEG with sharp.
 *
 * Conversion is lazy and cached on disk under `.blinko/cache/heif`, keyed by the
 * source identity (path + size + mtime) so a replaced file invalidates itself.
 * Originals are never modified; `?download=true` still serves the original bytes.
 */

const HEIF_EXTENSIONS = new Set(['.heic', '.heif', '.hif', '.heics', '.heifs']);

/** Longest edge of the cached preview used for inline rendering and lightboxes. */
export const HEIF_PREVIEW_MAX_EDGE = 2560;
export const HEIF_PREVIEW_QUALITY = 82;
/** Longest edge of the cached grid thumbnail (`?thumbnail=true`). */
export const HEIF_THUMBNAIL_MAX_EDGE = 500;
export const HEIF_THUMBNAIL_QUALITY = 78;

/** Guardrails: decoding runs on one JS thread, so reject absurd inputs. */
const MAX_DECODE_BYTES = 80 * 1024 * 1024;
const MAX_DECODE_PIXELS = 40_000_000;

/** Upper bound of cached JPEGs; older entries are pruned after a write. */
const CACHE_MAX_ENTRIES = 512;

const CACHE_DIR = path.join(ROOT_PATH, 'cache', 'heif');

export type HeifJpeg = {
  buffer: Buffer;
  /** Strong validator for the converted bytes, safe to reuse as an ETag. */
  etag: string;
};

export type HeifRenderOptions = {
  maxEdge: number;
  quality: number;
};

export function isHeifPath(filePath: string): boolean {
  return HEIF_EXTENSIONS.has(path.extname(filePath || '').toLowerCase());
}

export function isHeifMime(mimeType?: string | null): boolean {
  return !!mimeType && /^image\/hei[cf]\b/i.test(mimeType.trim());
}

type HeifDisplayData = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

type HeifImageHandle = {
  get_width(): number;
  get_height(): number;
  is_primary?(): boolean;
  display(output: { data: Uint8ClampedArray; width: number; height: number }, callback: (data?: HeifDisplayData | null) => void): void;
  free?(): void;
};

type LibheifModule = {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImageHandle[] };
};

let libheifModule: LibheifModule | null = null;

/**
 * libheif-js ships pure-JS, plain wasm and pre-bundled wasm builds. The wasm
 * build is ~5x faster than the pure-JS one (0.5s vs 6s for a 12MP photo) and the
 * pre-bundled variant embeds the binary, so nothing extra has to be shipped.
 *
 * It is loaded with require() on purpose: this emscripten bundle is CommonJS and
 * importing it through ESM hangs under Bun, while require() behaves identically
 * in Bun (dev) and Node (production).
 */
function loadLibheif(): LibheifModule {
  if (!libheifModule) {
    libheifModule = require('libheif-js/wasm-bundle') as LibheifModule;
  }
  return libheifModule;
}

/**
 * Decoding is CPU bound (roughly 0.5s-1.2s for a 12MP photo, more for larger
 * ones) and allocates width*height*4 bytes, so conversions are serialised inside
 * one process instead of letting a grid of tiles start N decodes at once.
 */
let decodeQueue: Promise<unknown> = Promise.resolve();

function withDecodeSlot<T>(task: () => Promise<T> | T): Promise<T> {
  const run = decodeQueue.then(task, task);
  decodeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function toJpegPipeline(input: sharp.Sharp, options: HeifRenderOptions): sharp.Sharp {
  return input
    .resize({
      width: options.maxEdge,
      height: options.maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: options.quality, mozjpeg: true });
}

/**
 * Decodes one HEIF container and returns a JPEG no larger than `maxEdge`.
 * Always resolves to a new Buffer; throws when the file is not decodable.
 */
export async function renderHeifToJpeg(
  source: Buffer,
  options: Partial<HeifRenderOptions> = {},
): Promise<Buffer> {
  const opts: HeifRenderOptions = {
    maxEdge: options.maxEdge ?? HEIF_PREVIEW_MAX_EDGE,
    quality: options.quality ?? HEIF_PREVIEW_QUALITY,
  };

  if (source.byteLength > MAX_DECODE_BYTES) {
    throw new Error(`HEIF source is too large to decode (${source.byteLength} bytes)`);
  }

  return withDecodeSlot(async () => {
    const libheif = loadLibheif();
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    if (!images?.length) {
      throw new Error('No HEIF image found in file');
    }

    // A HEIC usually carries the primary image plus thumbnails; keep the primary.
    const image = images.find(candidate => candidate.is_primary?.() === true) ?? images[0]!;
    try {
      const width = image.get_width();
      const height = image.get_height();
      if (!width || !height) {
        throw new Error('HEIF image has no dimensions');
      }
      if (width * height > MAX_DECODE_PIXELS) {
        throw new Error(`HEIF image is too large to decode (${width}x${height})`);
      }

      // libheif applies the container's rotation/mirror transforms while
      // decoding, so the pixels come out upright. EXIF orientation is not
      // applied on top of that to avoid rotating twice.
      const display = await new Promise<HeifDisplayData>((resolve, reject) => {
        image.display(
          { data: new Uint8ClampedArray(width * height * 4), width, height },
          data => (data ? resolve(data) : reject(new Error('HEIF pixel decoding failed'))),
        );
      });

      const raw = Buffer.from(display.data.buffer, display.data.byteOffset, display.data.byteLength);
      return await toJpegPipeline(
        sharp(raw, {
          raw: { width: display.width, height: display.height, channels: 4 },
        }),
        opts,
      ).toBuffer();
    } finally {
      for (const candidate of images) {
        try {
          candidate.free?.();
        } catch {
          // libheif handles are garbage collected anyway.
        }
      }
    }
  });
}

function cacheKey(sourceId: string, options: HeifRenderOptions): string {
  return crypto
    .createHash('sha256')
    .update(`${sourceId}|${options.maxEdge}|${options.quality}`)
    .digest('hex');
}

function cacheFile(key: string): string {
  return path.join(CACHE_DIR, `${key}.jpg`);
}

async function readCachedJpeg(key: string): Promise<Buffer | null> {
  try {
    return await readFile(cacheFile(key));
  } catch {
    return null;
  }
}

let pruning = false;

/** Best effort eviction of the oldest cached previews; never blocks the response. */
function pruneCache(): void {
  if (pruning) return;
  pruning = true;
  void (async () => {
    try {
      const entries = await readdir(CACHE_DIR, { withFileTypes: true });
      const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.jpg'));
      if (files.length <= CACHE_MAX_ENTRIES) return;
      const stats = await Promise.all(
        files.map(async file => {
          const filePath = path.join(CACHE_DIR, file.name);
          const info = await stat(filePath).catch(() => null);
          return { filePath, mtime: info?.mtimeMs ?? 0 };
        }),
      );
      stats.sort((a, b) => a.mtime - b.mtime);
      const excess = stats.slice(0, stats.length - CACHE_MAX_ENTRIES);
      await Promise.all(excess.map(item => unlink(item.filePath).catch(() => undefined)));
    } catch {
      // Cache maintenance is opportunistic.
    } finally {
      pruning = false;
    }
  })();
}

async function writeCachedJpeg(key: string, jpeg: Buffer): Promise<HeifJpeg> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const target = cacheFile(key);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, jpeg);
    await rename(temp, target);
    pruneCache();
  } catch (error) {
    // A cache miss must never fail the request; the bytes are already in memory.
    console.error('Unable to persist HEIF preview cache entry:', error);
  }
  return { buffer: jpeg, etag: `"${key}"` };
}

const inflight = new Map<string, Promise<HeifJpeg>>();

/** Reads an already converted preview without touching the source file. */
export async function readCachedHeifJpeg(
  sourceId: string,
  options: HeifRenderOptions,
): Promise<HeifJpeg | null> {
  const key = cacheKey(sourceId, options);
  const buffer = await readCachedJpeg(key);
  return buffer ? { buffer, etag: `"${key}"` } : null;
}

/**
 * Converts a HEIF buffer to JPEG, reusing a cached copy when `sourceId` is
 * unchanged. Concurrent requests for the same source share one conversion.
 */
export async function getHeifJpegFromSource(
  sourceId: string,
  load: () => Promise<Buffer>,
  options: HeifRenderOptions,
): Promise<HeifJpeg> {
  const cached = await readCachedHeifJpeg(sourceId, options);
  if (cached) return cached;

  const key = cacheKey(sourceId, options);
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const source = await load();
    const jpeg = await renderHeifToJpeg(source, options);
    return writeCachedJpeg(key, jpeg);
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

async function fileIdentity(filePath: string): Promise<string> {
  const info = await stat(filePath);
  return `${path.resolve(filePath)}|${info.size}|${info.mtimeMs}`;
}

const PREVIEW_OPTIONS: HeifRenderOptions = {
  maxEdge: HEIF_PREVIEW_MAX_EDGE,
  quality: HEIF_PREVIEW_QUALITY,
};

const THUMBNAIL_OPTIONS: HeifRenderOptions = {
  maxEdge: HEIF_THUMBNAIL_MAX_EDGE,
  quality: HEIF_THUMBNAIL_QUALITY,
};

/** Inline preview for a HEIF file on local disk (used by `/api/file/*`). */
export async function getHeifPreviewJpeg(filePath: string): Promise<HeifJpeg> {
  const identity = await fileIdentity(filePath);
  return getHeifJpegFromSource(identity, () => readFile(filePath), PREVIEW_OPTIONS);
}

/**
 * Grid thumbnail for a HEIF file. Reuses the cached preview so the expensive
 * decode runs at most once per file.
 */
export async function getHeifThumbnailJpeg(filePath: string): Promise<HeifJpeg> {
  const identity = await fileIdentity(filePath);
  const cached = await readCachedHeifJpeg(identity, THUMBNAIL_OPTIONS);
  if (cached) return cached;

  const preview = await getHeifJpegFromSource(identity, () => readFile(filePath), PREVIEW_OPTIONS);
  const thumbnail = await toJpegPipeline(sharp(preview.buffer), THUMBNAIL_OPTIONS).toBuffer();
  return writeCachedJpeg(cacheKey(identity, THUMBNAIL_OPTIONS), thumbnail);
}
