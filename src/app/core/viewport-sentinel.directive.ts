import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, inject, output } from '@angular/core';

@Directive({
  selector: '[appViewportSentinel]',
  standalone: true,
})
export class ViewportSentinelDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private intersectionObserver: IntersectionObserver | null = null;
  private repeatTimer: ReturnType<typeof window.setTimeout> | null = null;
  private isIntersecting = false;

  readonly appViewportSentinel = output<void>();

  ngAfterViewInit(): void {
    this.intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        this.isIntersecting = Boolean(entry?.isIntersecting);
        if (this.isIntersecting) {
          this.emitAndScheduleNext();
        } else {
          this.clearRepeatTimer();
        }
      },
      {
        root: null,
        rootMargin: '160px 0px',
        threshold: 0.01,
      },
    );
    this.intersectionObserver.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.clearRepeatTimer();
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
  }

  private emitAndScheduleNext(): void {
    if (this.repeatTimer) {
      return;
    }

    this.ngZone.run(() => this.appViewportSentinel.emit());
    this.repeatTimer = window.setTimeout(() => {
      this.repeatTimer = null;
      if (this.isIntersecting && this.isElementInViewport()) {
        this.emitAndScheduleNext();
      }
    }, 180);
  }

  private isElementInViewport(): boolean {
    const rect = this.elementRef.nativeElement.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= window.innerHeight + 160;
  }

  private clearRepeatTimer(): void {
    if (this.repeatTimer) {
      window.clearTimeout(this.repeatTimer);
      this.repeatTimer = null;
    }
  }
}
