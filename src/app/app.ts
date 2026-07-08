import { formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, LOCALE_ID, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { filter } from 'rxjs';

import { FirebaseMessagingService, OPEN_NOTIFICATIONS_MESSAGE } from './core/firebase-messaging.service';
import { ThemeService } from './core/theme.service';
import { ToolboxStateService } from './core/toolbox-state.service';
import { VersionCheckService } from './core/version-check.service';

@Component({
  selector: 'app-root',
  imports: [
    MatBadgeModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MatSidenavModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  private static readonly relativeTimeLimitMs = 12 * 60 * 60 * 1000;

  readonly state = inject(ToolboxStateService);
  readonly auth = this.state.auth;
  readonly messaging = inject(FirebaseMessagingService);
  private readonly theme = inject(ThemeService);
  readonly loading = this.state.loading;
  readonly isSignedIn = computed(() => Boolean(this.auth.currentUser()));
  private readonly router = inject(Router);
  private readonly versionCheck = inject(VersionCheckService);
  private readonly locale = inject(LOCALE_ID);
  readonly isPublicRoute = signal(true);
  readonly isHomeRoute = signal(false);
  readonly notificationsOpen = signal(false);
  readonly headerRaised = signal(false);
  private pendingNotificationsOpen = false;
  private readonly clockInterval = window.setInterval(() => this.now.set(Date.now()), 60_000);
  private readonly now = signal(Date.now());
  private readonly windowScrollHandler = () => this.updateHeaderRaised();
  private readonly serviceWorkerMessageHandler = (event: MessageEvent) => {
    if (event.data?.type === OPEN_NOTIFICATIONS_MESSAGE) {
      this.openNotifications();
    }
  };

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.isPublicRoute.set(this.checkIsPublicRoute(this.router.url));
      this.isHomeRoute.set(this.checkIsHomeRoute(this.router.url));
      this.headerRaised.set(false);
      this.closeDrawers();
      this.openNotificationsFromUrl(this.router.url);
    });
    this.isPublicRoute.set(this.checkIsPublicRoute(this.router.url));
    this.isHomeRoute.set(this.checkIsHomeRoute(this.router.url));
    this.openNotificationsFromUrl(this.router.url);
    window.addEventListener('scroll', this.windowScrollHandler, { passive: true });
    navigator.serviceWorker?.addEventListener('message', this.serviceWorkerMessageHandler);
    effect(() => {
      if (this.messaging.notificationOpenRequests() > 0) {
        this.openNotifications();
      }
    });
    effect(() => {
      if (this.pendingNotificationsOpen && this.isSignedIn()) {
        this.pendingNotificationsOpen = false;
        this.openNotifications();
      }
    });
    this.lockPortraitOrientation();
    this.versionCheck.start();
  }

  ngOnDestroy(): void {
    window.clearInterval(this.clockInterval);
    window.removeEventListener('scroll', this.windowScrollHandler);
    navigator.serviceWorker?.removeEventListener('message', this.serviceWorkerMessageHandler);
  }

  async signOut(): Promise<void> {
    await this.state.signOut();
  }

  dismissForegroundNotification(): void {
    this.messaging.dismissForegroundNotification();
  }

  openNotifications(): void {
    if (!this.isSignedIn()) {
      this.pendingNotificationsOpen = true;
      return;
    }

    this.now.set(Date.now());
    this.notificationsOpen.set(true);
    this.state.startNotificationsLiveRefresh();
  }

  closeNotifications(): void {
    this.notificationsOpen.set(false);
    this.state.stopNotificationsLiveRefresh();
  }

  closeDrawers(): void {
    this.notificationsOpen.set(false);
    this.state.stopNotificationsLiveRefresh();
  }

  onContentScroll(event: Event): void {
    const element = event.target;
    if (element instanceof HTMLElement) {
      this.updateHeaderRaised(element.scrollTop);
    }
  }

  formatNotificationTime(value: string): string {
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) {
      return value;
    }

    const elapsedMs = this.now() - timestamp;
    if (elapsedMs >= 0 && elapsedMs < App.relativeTimeLimitMs) {
      const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / 60_000));
      if (elapsedMinutes < 60) {
        return `${elapsedMinutes} ${elapsedMinutes === 1 ? 'minute' : 'minutes'} ago`;
      }

      const elapsedHours = Math.floor(elapsedMinutes / 60);
      return `${elapsedHours} ${elapsedHours === 1 ? 'hour' : 'hours'} ago`;
    }

    return formatDate(value, 'short', this.locale);
  }

  private checkIsPublicRoute(url: string): boolean {
    const [path] = url.split('?');
    return ['/home', '/about', '/privacy', '/'].includes(path || '/');
  }

  private checkIsHomeRoute(url: string): boolean {
    const [path] = url.split('?');
    return ['/home', '/'].includes(path || '/');
  }

  private openNotificationsFromUrl(url: string): void {
    const [, query = ''] = url.split('?');
    const searchParams = new URLSearchParams(query.split('#')[0]);
    if (searchParams.get('notifications') === 'open') {
      this.pendingNotificationsOpen = true;
      this.openNotifications();
    }
  }

  private async lockPortraitOrientation(): Promise<void> {
    const screenOrientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    };
    if (!screenOrientation?.lock) {
      return;
    }

    try {
      await screenOrientation.lock('portrait');
    } catch {
      // Browsers may block orientation locking outside installed app contexts.
    }
  }

  private updateHeaderRaised(contentScrollTop = 0): void {
    const documentScrollTop = window.scrollY || this.documentScrollTop();
    this.headerRaised.set(contentScrollTop > 0 || documentScrollTop > 0);
  }

  private documentScrollTop(): number {
    return document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

}
