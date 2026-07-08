import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-home-view',
  imports: [],
  templateUrl: './home-view.html',
  styleUrl: './home-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class HomeViewComponent {
  readonly state = inject(ToolboxStateService);
  readonly auth = this.state.auth;

  async signIn(): Promise<void> {
    await this.state.signIn();
  }
}
