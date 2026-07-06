import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { filter } from 'rxjs';

import { APP_SETTINGS } from './core/app-settings';
import { ThemeService } from './core/theme.service';
import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-root',
  imports: [
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
  readonly theme = inject(ThemeService);
  readonly loading = this.state.loading;
  readonly isSignedIn = computed(() => Boolean(this.auth.currentUser()));
  private readonly router = inject(Router);
  readonly isPublicRoute = signal(true);
  readonly menuOpen = signal(false);

  get title(): string {
    return APP_SETTINGS.appName;
  }

  get version(): string {
    return APP_SETTINGS.version;
  }

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.isPublicRoute.set(this.checkIsPublicRoute(this.router.url));
      this.menuOpen.set(false);
    });
    this.isPublicRoute.set(this.checkIsPublicRoute(this.router.url));
    this.lockPortraitOrientation();
  }

  async signOut(): Promise<void> {
    await this.state.signOut();
  }

  async refresh(): Promise<void> {
    await this.state.refresh();
    this.menuOpen.set(false);
  }

  async requestTool(): Promise<void> {
    this.menuOpen.set(false);
    await this.state.requestTool();
  }

  async requestNotificationPermission(): Promise<void> {
    this.menuOpen.set(false);
    await this.state.requestNotificationPermission();
  }

  openMenu(): void {
    this.menuOpen.set(true);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  toggleTheme(): void {
    this.theme.toggleMode();
  }

  get nextThemeIcon(): string {
    return this.theme.mode() === 'dark' ? 'light_mode' : 'dark_mode';
  }

  get nextThemeLabel(): string {
    return this.theme.mode() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }

  private checkIsPublicRoute(url: string): boolean {
    const [path] = url.split('?');
    return ['/home', '/about', '/privacy', '/'].includes(path || '/');
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
