import { Directive, ElementRef, OnChanges, OnDestroy, SimpleChanges, inject, input } from '@angular/core';

import { GoogleAuthService } from './google-auth.service';
import { TOOL_PLACEHOLDER_URL, extractGoogleDriveFileId, normalizeImageUrl } from './image-url.util';

@Directive({
  selector: 'img[appResolvedSrc]',
  standalone: true,
})
export class ResolvedImageDirective implements OnChanges, OnDestroy {
  private static readonly cachedObjectUrls = new Map<string, string>();
  private static readonly inflightFetches = new Map<string, Promise<string | null>>();

  private readonly elementRef = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly auth = inject(GoogleAuthService);
  private requestVersion = 0;

  readonly appResolvedSrc = input('');

  ngOnChanges(changes: SimpleChanges): void {
    if ('appResolvedSrc' in changes) {
      void this.updateImage();
    }
  }

  ngOnDestroy(): void {
    this.requestVersion += 1;
  }

  private async updateImage(): Promise<void> {
    const requestVersion = ++this.requestVersion;
    const rawValue = this.appResolvedSrc();
    const driveFileId = extractGoogleDriveFileId(rawValue);
    if (!driveFileId) {
      const normalizedUrl = normalizeImageUrl(rawValue) || TOOL_PLACEHOLDER_URL;
      this.elementRef.nativeElement.src = normalizedUrl;
      return;
    }

    this.elementRef.nativeElement.src = TOOL_PLACEHOLDER_URL;

    const cachedObjectUrl = ResolvedImageDirective.cachedObjectUrls.get(driveFileId);
    if (cachedObjectUrl) {
      this.setImageSource(requestVersion, cachedObjectUrl);
      return;
    }

    const objectUrl = await this.fetchDriveObjectUrl(driveFileId);
    if (!objectUrl) {
      return;
    }

    this.setImageSource(requestVersion, objectUrl);
  }

  private setImageSource(requestVersion: number, value: string): void {
    if (requestVersion !== this.requestVersion) {
      return;
    }

    this.elementRef.nativeElement.src = value;
  }

  private async fetchDriveObjectUrl(fileId: string): Promise<string | null> {
    const existingRequest = ResolvedImageDirective.inflightFetches.get(fileId);
    if (existingRequest) {
      return existingRequest;
    }

    const request = this.fetchDriveObjectUrlInternal(fileId);
    ResolvedImageDirective.inflightFetches.set(fileId, request);

    try {
      return await request;
    } finally {
      ResolvedImageDirective.inflightFetches.delete(fileId);
    }
  }

  private async fetchDriveObjectUrlInternal(fileId: string): Promise<string | null> {
    const hasSession = await this.auth.ensureValidSession();
    const accessToken = this.auth.accessToken();
    if (!hasSession || !accessToken) {
      return null;
    }

    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.startsWith('image/')) {
        return null;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      ResolvedImageDirective.cachedObjectUrls.set(fileId, objectUrl);
      return objectUrl;
    } catch {
      return null;
    }
  }
}
