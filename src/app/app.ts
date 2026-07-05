import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';

import { APP_SETTINGS } from './core/app-settings';
import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-root',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    MatToolbarModule,
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
  readonly title = APP_SETTINGS.appName;
  readonly loading = this.state.loading;
  readonly isSignedIn = computed(() => Boolean(this.auth.currentUser()));

  constructor() {
    this.lockPortraitOrientation();
  }

  async signIn(): Promise<void> {
    await this.state.signIn();
  }

  async signOut(): Promise<void> {
    await this.state.signOut();
  }

  async refresh(): Promise<void> {
    await this.state.refresh();
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
