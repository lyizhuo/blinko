import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  HEIF_THUMBNAIL_MAX_EDGE,
  getHeifPreviewJpeg,
  getHeifThumbnailJpeg,
  isHeifMime,
  isHeifPath,
  renderHeifToJpeg,
} from '../../../lib/heif';

const FIXTURE_DIR = path.join(import.meta.dir, '../../__fixtures__/heif');
const FIXTURE = path.join(FIXTURE_DIR, 'sample.heic');
const CACHE_DIR = path.join(process.cwd(), '.blinko/cache/heif');

function isJpeg(buffer: Buffer): boolean {
  return buffer.byteLength > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

describe('isHeifPath', () => {
  test('recognises HEIF family extensions regardless of case', () => {
    expect(isHeifPath('/uploads/IMG_0001.heic')).toBe(true);
    expect(isHeifPath('/uploads/IMG_0001.HEIC')).toBe(true);
    expect(isHeifPath('/uploads/photo.heif')).toBe(true);
    expect(isHeifPath('/uploads/photo.HIF')).toBe(true);
  });

  test('ignores other types and extension-less names', () => {
    expect(isHeifPath('/uploads/photo.jpg')).toBe(false);
    expect(isHeifPath('/uploads/clip.mp4')).toBe(false);
    expect(isHeifPath('/uploads/heic')).toBe(false);
    expect(isHeifPath('')).toBe(false);
  });
});

describe('isHeifMime', () => {
  test('detects the image/heic and image/heif media types', () => {
    expect(isHeifMime('image/heic')).toBe(true);
    expect(isHeifMime('image/heif')).toBe(true);
    expect(isHeifMime('IMAGE/HEIC')).toBe(true);
  });

  test('rejects unrelated or missing media types', () => {
    expect(isHeifMime('image/jpeg')).toBe(false);
    expect(isHeifMime('application/octet-stream')).toBe(false);
    expect(isHeifMime(undefined)).toBe(false);
    expect(isHeifMime('')).toBe(false);
  });
});

describe('renderHeifToJpeg', () => {
  test('decodes an HEVC HEIC into a JPEG', async () => {
    const source = await fs.readFile(FIXTURE);
    const jpeg = await renderHeifToJpeg(source);

    expect(isJpeg(jpeg)).toBe(true);
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });

  test('keeps the image upright (top row stays at the top)', async () => {
    const source = await fs.readFile(FIXTURE);
    const jpeg = await renderHeifToJpeg(source, { maxEdge: 320, quality: 90 });
    const { data, info } = await sharp(jpeg)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
    };

    // The fixture paints a red bar across the top and a gradient below it.
    const [topRed, topGreen, topBlue] = pixel(4, 4);
    expect(topRed).toBeGreaterThan(200);
    expect(topGreen).toBeLessThan(80);
    expect(topBlue).toBeLessThan(80);

    const [bottomRed, bottomGreen] = pixel(4, info.height - 8);
    expect(bottomRed).toBeLessThan(120);
    expect(bottomGreen).toBeGreaterThan(80);
  });

  test('honours maxEdge', async () => {
    const source = await fs.readFile(FIXTURE);
    const jpeg = await renderHeifToJpeg(source, { maxEdge: 100 });
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(75);
  });

  test('rejects bytes that are not a HEIF container', async () => {
    expect(renderHeifToJpeg(Buffer.from('definitely not a heic'))).rejects.toThrow();
  });
});

describe('preview cache', () => {
  beforeAll(async () => {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
  });

  test('converts once and reuses the cached JPEG afterwards', async () => {
    const first = await getHeifPreviewJpeg(FIXTURE);
    expect(isJpeg(first.buffer)).toBe(true);
    expect(first.etag.startsWith('"')).toBe(true);

    const cacheFiles = await fs.readdir(CACHE_DIR);
    expect(cacheFiles.filter(name => name.endsWith('.jpg'))).toHaveLength(1);

    const second = await getHeifPreviewJpeg(FIXTURE);
    expect(second.etag).toBe(first.etag);
    expect(second.buffer.equals(first.buffer)).toBe(true);

    const afterSecond = await fs.readdir(CACHE_DIR);
    expect(afterSecond.filter(name => name.endsWith('.jpg'))).toHaveLength(1);
  });

  test('deduplicates concurrent conversions of the same file', async () => {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
    const results = await Promise.all([
      getHeifPreviewJpeg(FIXTURE),
      getHeifPreviewJpeg(FIXTURE),
      getHeifPreviewJpeg(FIXTURE),
    ]);

    expect(new Set(results.map(result => result.etag)).size).toBe(1);
    const cacheFiles = await fs.readdir(CACHE_DIR);
    expect(cacheFiles.filter(name => name.endsWith('.jpg'))).toHaveLength(1);
  });

  test('builds a thumbnail no larger than the configured edge', async () => {
    const thumbnail = await getHeifThumbnailJpeg(FIXTURE);
    expect(isJpeg(thumbnail.buffer)).toBe(true);
    const metadata = await sharp(thumbnail.buffer).metadata();
    expect(metadata.width).toBeLessThanOrEqual(HEIF_THUMBNAIL_MAX_EDGE);
    expect(metadata.height).toBeLessThanOrEqual(HEIF_THUMBNAIL_MAX_EDGE);
    // The fixture is smaller than the thumbnail edge, so it must not be enlarged.
    expect(metadata.width).toBe(320);
  });
});
