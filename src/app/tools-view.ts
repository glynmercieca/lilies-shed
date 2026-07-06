import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { fallbackImage, resolveToolImageUrl } from './core/image-url.util';
import { ResolvedImageDirective } from './core/resolved-image.directive';
import { ToolboxStateService } from './core/toolbox-state.service';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-tools-view',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatIconModule,
    MatInputModule,
    ResolvedImageDirective,
  ],
  templateUrl: './tools-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolsViewComponent {
  readonly state = inject(ToolboxStateService);
  readonly searchFocused = signal(false);
  protected readonly fallbackImage = fallbackImage;
  protected readonly resolveToolImageUrl = resolveToolImageUrl;

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
