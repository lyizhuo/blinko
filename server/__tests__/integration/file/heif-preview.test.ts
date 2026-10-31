import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import type { Server } from 'http';
import sharp from 'sharp';

const UPLOAD_ROOT = path.join(process.cwd(), '.blinko/files');
const HEIF_REL = 'heif-test/sample.heic';
const HEIF_ABS = path.join(UPLOAD_ROOT, HEIF_REL);
const FIXTURE = path.join(import.meta.dir, '../../__fixtures__/heif/sample.heic');
const CACHE_DIR = path.join(process.cwd(), '.blinko/cache/heif');

// The route only needs an attachment row to authorise the read; a shared note is
// enough to exercise the conversion path without a database.
mock.module('../../../prisma', () => ({
  prisma: {
    attachments: {
      findFirst: mock(async () => ({
        id: 1,
        accountId: 1,
        note: { isShare: true, accountId: 1 },
      })),
    },
  },
}));

mock.module('@server/routerTrpc/config', () => ({
  getGlobalConfig: mock(async () => ({})),
}));

// Bypass the storage-path policy: the fixture lives under the real upload root.
mock.module('../../../lib/files', () => ({
  FileService: {
    validateAndResolvePath: (relative: string) => path.resolve(UPLOAD_ROOT, relative),
  },
}));

const { default: fileRouter } = await import('../../../routerExpress/file/file');

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  await fs.mkdir(path.dirname(HEIF_ABS), { recursive: true });
  await fs.copyFile(FIXTURE, HEIF_ABS);

  const app = express();
  app.use('/api/file', fileRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  await fs.rm(path.dirname(HEIF_ABS), { recursive: true, force: true });
  await fs.rm(CACHE_DIR, { recursive: true, force: true });
});

function fileUrl(query = ''): string {
  return `${baseUrl}/api/file/${HEIF_REL}${query}`;
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.byteLength > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

describe('GET /api/file/:path for HEIF sources', () => {
  test('serves inline previews as JPEG', async () => {
    const response = await fetch(fileUrl());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/jpeg');

    const body = Buffer.from(await response.arrayBuffer());
    expect(isJpeg(body)).toBe(true);
    const metadata = await sharp(body).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });

  test('serves a thumbnail for the grid', async () => {
    const response = await fetch(fileUrl('?thumbnail=true'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/jpeg');

    const body = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(body).metadata();
    expect(metadata.width).toBeLessThanOrEqual(500);
    expect(metadata.height).toBeLessThanOrEqual(500);
  });

  test('revalidates with the conversion ETag', async () => {
    const first = await fetch(fileUrl());
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    await first.arrayBuffer();

    const second = await fetch(fileUrl(), { headers: { 'if-none-match': etag! } });
    expect(second.status).toBe(304);
  });

  test('downloads keep the original HEIC bytes', async () => {
    const response = await fetch(fileUrl('?download=true'));
    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    const original = await fs.readFile(HEIF_ABS);
    expect(body.equals(original)).toBe(true);
    expect(isJpeg(body)).toBe(false);
    expect(response.headers.get('content-disposition')).toContain('attachment');
  });

  test('non-HEIF images are untouched', async () => {
    const jpegPath = path.join(UPLOAD_ROOT, 'heif-test/plain.jpg');
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3366cc' } })
      .jpeg()
      .toFile(jpegPath);

    const response = await fetch(`${baseUrl}/api/file/heif-test/plain.jpg?thumbnail=true`);
    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    expect(isJpeg(body)).toBe(true);
    const metadata = await sharp(body).metadata();
    expect(metadata.width).toBe(40);
  });
});
