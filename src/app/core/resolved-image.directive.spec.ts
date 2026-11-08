import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResolvedImageDirective } from './resolved-image.directive';
import { ThumbnailCacheService } from './thumbnail-cache.service';

@Component({ imports: [ResolvedImageDirective], template: '<img loading="lazy" [appResolvedSrc]="url()" [appCacheImage]="true">' })
class Host {
  readonly url = signal('https://example.test/old.webp');
}

let intersect: (entries: { isIntersecting: boolean }[]) => void;
let load: ReturnType<typeof vi.fn>;
beforeEach(() => {
  load = vi.fn();
  TestBed.configureTestingModule({ providers: [{ provide: ThumbnailCacheService, useValue: { load } }] });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:thumbnail'), revokeObjectURL: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it('waits for the viewport, displays the cached blob and releases it on destroy', async () => {
  load.mockResolvedValue(new Blob(['photo']));
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  expect(load).not.toHaveBeenCalled();
  intersect([{ isIntersecting: true }]);
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('blob:thumbnail');
  fixture.destroy();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail');
});

it('ignores an old download finishing after the thumbnail URL changes', async () => {
  let finish!: (value: Blob) => void;
  load.mockImplementationOnce(() => new Promise<Blob>(resolve => { finish = resolve; }));
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  intersect([{ isIntersecting: true }]);
  fixture.componentInstance.url.set('https://example.test/new.webp');
  fixture.detectChanges();
  load.mockResolvedValueOnce(null);
  intersect([{ isIntersecting: true }]);
  await fixture.whenStable();
  finish(new Blob(['old']));
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe('https://example.test/new.webp');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
