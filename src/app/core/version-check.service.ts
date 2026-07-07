import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { APP_SETTINGS } from './app-settings';

interface AppVersionPayload {
  version?: string;
}

@Injectable({ providedIn: 'root' })
export class VersionCheckService {
  private static readonly checkIntervalMs = 5 * 60 * 1000;

  private readonly snackBar = inject(MatSnackBar);
  private started = false;
  private promptShown = false;
  private intervalId: ReturnType<typeof window.setInterval> | null = null;
  private readonly currentVersion = APP_SETTINGS.version.trim();

  start(): void {
    if (this.started || !this.currentVersion || typeof window === 'undefined') {
      return;
    }

    this.started = true;
    void this.checkForUpdate();

    this.intervalId = window.setInterval(() => {
      void this.checkForUpdate();
    }, VersionCheckService.checkIntervalMs);

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('focus', this.handleFocus);
  }

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void this.checkForUpdate();
    }
  };

  private readonly handleFocus = () => {
    void this.checkForUpdate();
  };

  private async checkForUpdate(): Promise<void> {
    if (this.promptShown) {
      return;
    }

    try {
      const response = await fetch(this.versionUrl(), {
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as AppVersionPayload;
      const deployedVersion = (payload.version || '').trim();
      if (!deployedVersion || !this.isNewerVersion(deployedVersion, this.currentVersion)) {
        return;
      }

      this.promptShown = true;
      const snackBarRef = this.snackBar.open(
        `Version ${deployedVersion} is available.`,
        'Reload',
      );
      snackBarRef.onAction().subscribe(() => window.location.reload());
    } catch {
      // Ignore transient fetch failures for background version checks.
    }
  }

  private versionUrl(): string {
    const url = new URL('app-version.json', document.baseURI);
    url.searchParams.set('t', Date.now().toString());
    return url.toString();
  }

  private isNewerVersion(candidate: string, current: string): boolean {
    const candidateParts = this.parseVersion(candidate);
    const currentParts = this.parseVersion(current);
    const maxLength = Math.max(candidateParts.length, currentParts.length);

    for (let index = 0; index < maxLength; index += 1) {
      const candidateValue = candidateParts[index] ?? 0;
      const currentValue = currentParts[index] ?? 0;

      if (candidateValue > currentValue) {
        return true;
      }

      if (candidateValue < currentValue) {
        return false;
      }
    }

    return false;
  }

  private parseVersion(version: string): number[] {
    return version
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((value) => (Number.isFinite(value) ? value : 0));
  }
}
