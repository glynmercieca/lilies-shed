import { Directive, ElementRef, OnChanges, OnDestroy, SimpleChanges, inject, input } from '@angular/core';

import { TOOL_PLACEHOLDER_URL, normalizeImageUrl } from './image-url.util';
import { ThumbnailCacheService } from './thumbnail-cache.service';

@Directive({
  selector: 'img[appResolvedSrc]',
  standalone: true,
})
export class ResolvedImageDirective implements OnChanges, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly cache = inject(ThumbnailCacheService);
  private observer?: IntersectionObserver;
  private objectUrl?: string;
  private revision = 0;

  readonly appResolvedSrc = input('');
  readonly appCacheImage = input(false);

  ngOnChanges(changes: SimpleChanges): void {
    if ('appResolvedSrc' in changes || 'appCacheImage' in changes) {
      this.release();
      const revision = this.revision;
      const normalizedUrl = normalizeImageUrl(this.appResolvedSrc()) || TOOL_PLACEHOLDER_URL;
      const image = this.elementRef.nativeElement;
      if (!this.appCacheImage() || !/^https?:\/\//i.test(normalizedUrl)) {
        image.src = normalizedUrl;
        return;
      }
      image.src = TOOL_PLACEHOLDER_URL;
      const load = async () => {
        const blob = await this.cache.load(normalizedUrl);
        if (revision !== this.revision) return;
        this.objectUrl = blob ? URL.createObjectURL(blob) : undefined;
        image.src = this.objectUrl ?? normalizedUrl;
      };
      if (image.getAttribute('loading') === 'lazy' && typeof IntersectionObserver !== 'undefined') {
        this.observer = new IntersectionObserver(entries => {
          if (!entries.some(entry => entry.isIntersecting)) return;
          this.observer?.disconnect();
          void load();
        }, { rootMargin: '200px' });
        this.observer.observe(image);
      } else {
        void load();
      }
    }
  }

  ngOnDestroy(): void {
    this.release();
  }

  private release(): void {
    this.revision++;
    this.observer?.disconnect();
    this.observer = undefined;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }
}
