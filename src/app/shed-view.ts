import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { ToolboxStateService } from './core/toolbox-state.service';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-tools-view',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatMenuModule,
    ToolCardComponent,
  ],
  templateUrl: './shed-view.html',
  styleUrl: './shed-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolsViewComponent {
  readonly state = inject(ToolboxStateService);
  readonly searchFocused = signal(false);

  onSearchFocusIn(): void {
    this.searchFocused.set(true);
  }

  onSearchFocusOut(event: FocusEvent): void {
    const currentTarget = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (
      currentTarget instanceof HTMLElement &&
      nextTarget instanceof Node &&
      currentTarget.contains(nextTarget)
    ) {
      return;
    }

    this.searchFocused.set(false);
  }
}
