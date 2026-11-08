import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThumbnailCacheService } from './thumbnail-cache.service';

let entries: Map<string, Response>;
let download: ReturnType<typeof vi.fn>;
let put: ReturnType<typeof vi.fn>;

beforeEach(() => {
  entries = new Map();
  put = vi.fn(async (url: string, response: Response) => { entries.set(url, response.clone()); });
  vi.stubGlobal('caches', { open: vi.fn(async () => ({
    match: async (url: string) => entries.get(url)?.clone(),
    put,
    keys: async () => [...entries.keys()],
    delete: async (url: string) => entries.delete(url),
  })) });
  download = vi.fn(async () => new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
  vi.stubGlobal('fetch', download);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
});

afterEach(() => vi.unstubAllGlobals());

it('reuses the persisted image across service instances and downloads a changed URL', async () => {
  const url = 'https://example.test/photo.webp?token=one';
  const first = TestBed.inject(ThumbnailCacheService);
  expect(await first.load(url)).not.toBeNull();
  const nextSession = new ThumbnailCacheService();
  expect(await nextSession.load(url)).not.toBeNull();
  expect(download).toHaveBeenCalledOnce();
  await nextSession.load('https://example.test/photo.webp?token=two');
  expect(download).toHaveBeenCalledTimes(2);
});

it('shares simultaneous downloads and bounds the persistent cache', async () => {
  for (let i = 0; i < 300; i++) entries.set('https://example.test/' + i, new Response('old'));
  const service = TestBed.inject(ThumbnailCacheService);
  const url = 'https://example.test/new.webp';
  await Promise.all([service.load(url), service.load(url), service.load('https://example.test/other.webp')]);
  expect(download).toHaveBeenCalledTimes(2);
  expect(entries.size).toBe(300);
  expect(entries.has(url)).toBe(true);
  expect(entries.has('https://example.test/0')).toBe(false);
});

it('does not cache HTTP errors, non-images or undecodable images and allows retries', async () => {
  const service = TestBed.inject(ThumbnailCacheService);
  const url = 'https://example.test/photo.webp';
  download.mockResolvedValueOnce(new Response('error', { status: 504 }));
  expect(await service.load(url)).toBeNull();
  download.mockResolvedValueOnce(new Response('not an image', { headers: { 'content-type': 'text/html' } }));
  expect(await service.load(url)).toBeNull();
  vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('Bad image'));
  expect(await service.load(url)).toBeNull();
  expect(put).not.toHaveBeenCalled();
  expect(await service.load(url)).not.toBeNull();
  expect(put).toHaveBeenCalledOnce();
});

it('falls back when local storage is unavailable or full', async () => {
  const service = TestBed.inject(ThumbnailCacheService);
  vi.mocked(caches.open).mockRejectedValueOnce(new Error('Storage blocked'));
  expect(await service.load('https://example.test/blocked.webp')).toBeNull();
  expect(download).not.toHaveBeenCalled();
  put.mockRejectedValueOnce(new Error('Quota exceeded'));
  expect(await service.load('https://example.test/full.webp')).not.toBeNull();
});
