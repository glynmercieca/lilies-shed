import { DestroyRef, Injectable, inject, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  readonly online = signal(typeof navigator === 'undefined' || navigator.onLine);
  readonly availabilityVerified = signal(false);

  constructor() {
    const update = () => {
      this.online.set(navigator.onLine);
      if (!navigator.onLine) this.availabilityVerified.set(false);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}
