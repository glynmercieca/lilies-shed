import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { filter } from 'rxjs';

import { FirebaseMessagingService } from './core/firebase-messaging.service';
import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-root',
  imports: [
    DatePipe,
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
export class App {
  readonly state = inject(ToolboxStateService);
  readonly auth = this.state.auth;
  readonly messaging = inject(FirebaseMessagingService);
  readonly loading = this.state.loading;
  readonly isSignedIn = computed(() => Boolean(this.auth.currentUser()));
  private readonly router = inject(Router);
  readonly isPublicRoute = signal(true);
  readonly isHomeRoute = signal(false);
  readonly notificationsOpen = signal(false);

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.isPublicRoute.set(this.checkIsPublicRoute(this.router.url));
      this.isHomeRoute.set(this.checkIsHomeRoute(this.router.url));
      this.closeDrawers();
    });
    this.isPublicRoute.set(this.checkIsPublicRoute(this.router.url));
    this.isHomeRoute.set(this.checkIsHomeRoute(this.router.url));
    this.lockPortraitOrientation();
  }

  async signOut(): Promise<void> {
    await this.state.signOut();
  }

  dismissForegroundNotification(): void {
    this.messaging.dismissForegroundNotification();
  }

  openNotifications(): void {
    this.notificationsOpen.set(true);
  }

  closeNotifications(): void {
    this.notificationsOpen.set(false);
  }

  closeDrawers(): void {
    this.notificationsOpen.set(false);
  }

  private checkIsPublicRoute(url: string): boolean {
    const [path] = url.split('?');
    return ['/home', '/about', '/privacy', '/'].includes(path || '/');
  }

  private checkIsHomeRoute(url: string): boolean {
    const [path] = url.split('?');
    return ['/home', '/'].includes(path || '/');
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
}
