import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';

import { APP_SETTINGS } from './core/app-settings';
import { ThemeService } from './core/theme.service';
import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-options-view',
  imports: [MatButtonModule, MatButtonToggleModule, MatCardModule, MatIconModule, MatSlideToggleModule, RouterLink],
  templateUrl: './options-view.html',
  styleUrl: './options-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class OptionsViewComponent {
  readonly state = inject(ToolboxStateService);
  readonly theme = inject(ThemeService);
  readonly isRefreshing = computed(() => this.state.loading());
  readonly notificationsEnabled = signal(Notification.permission === 'granted');

  get version(): string {
    return APP_SETTINGS.version;
  }

  get themeMode(): 'light' | 'dark' {
    return this.theme.mode();
  }

  async requestTool(): Promise<void> {
    await this.state.requestTool();
  }

  async requestNotificationPermission(): Promise<void> {
    await this.state.requestNotificationPermission();
    this.notificationsEnabled.set(Notification.permission === 'granted');
  }

  async refresh(): Promise<void> {
    await this.state.refresh();
  }

  async signOut(): Promise<void> {
    await this.state.signOut();
  }

  setTheme(mode: 'light' | 'dark'): void {
    this.theme.setMode(mode);
  }

  async onNotificationsToggle(): Promise<void> {
    if (!this.notificationsEnabled()) {
      await this.requestNotificationPermission();
      return;
    }

    this.notificationsEnabled.set(Notification.permission === 'granted');
  }
}
