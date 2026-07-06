import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { APP_SETTINGS } from './core/app-settings';
import { ThemeService } from './core/theme.service';
import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-options-view',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './options-view.html',
  styleUrl: './options-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class OptionsViewComponent {
  readonly state = inject(ToolboxStateService);
  readonly theme = inject(ThemeService);
  readonly isRefreshing = computed(() => this.state.loading());

  get version(): string {
    return APP_SETTINGS.version;
  }

  get themeIcon(): string {
    return this.theme.mode() === 'dark' ? 'light_mode' : 'dark_mode';
  }

  async requestTool(): Promise<void> {
    await this.state.requestTool();
  }

  async requestNotificationPermission(): Promise<void> {
    await this.state.requestNotificationPermission();
  }

  async refresh(): Promise<void> {
    await this.state.refresh();
  }

  async signOut(): Promise<void> {
    await this.state.signOut();
  }

  toggleTheme(): void {
    this.theme.toggleMode();
  }
}
