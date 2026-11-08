import { Injectable } from '@angular/core';

const CACHE_NAME = 'lilies-shed-thumbnails-v1';
const MAX_ENTRIES = 300;

@Injectable({ providedIn: 'root' })
export class ThumbnailCacheService {
  private readonly pending = new Map<string, Promise<Blob | null>>();
  private writes: Promise<void> = Promise.resolve();

  load(url: string): Promise<Blob | null> {
    const existing = this.pending.get(url);
    if (existing) return existing;
    const request = this.readOrDownload(url).finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }

  private async readOrDownload(url: string): Promise<Blob | null> {
    try {
      if (!('caches' in globalThis) || !/^https?:\/\//i.test(url)) return null;
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) return await cached.blob();

      const response = await fetch(url);
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
      const blob = await response.clone().blob();
      // Only persist a successfully decoded image, never an error page or bad upload.
      await createImageBitmap(blob).then(image => image.close());
      // Serialize writes so simultaneous card loads cannot exceed the limit.
      this.writes = this.writes.then(async () => {
        await cache.put(url, response);
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map(key => cache.delete(key)));
      }).catch(() => undefined);
      await this.writes;
      return blob;
    } catch {
      // Restricted storage, CORS, offline misses and quota errors retain normal <img> loading.
      return null;
    }
  }
}
