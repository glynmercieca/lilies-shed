import { TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ToolboxStateService } from './core/toolbox-state.service';
import { ViewportSentinelDirective } from './core/viewport-sentinel.directive';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-shed-view',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    TitleCasePipe,
    ToolCardComponent,
    ViewportSentinelDirective,
  ],
  templateUrl: './shed-view.html',
  styleUrl: './shed-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ShedViewComponent {
  readonly state = inject(ToolboxStateService);
  readonly searchFocused = signal(false);

  onCategoryWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.deltaY === 0) {
      return;
    }

    const strip = event.currentTarget;
    if (!(strip instanceof HTMLElement) || strip.scrollWidth <= strip.clientWidth) {
      return;
    }

    const delta = this.normalizedWheelDelta(event.deltaY, event.deltaMode, strip.clientWidth);
    const nextScrollLeft = Math.min(
      Math.max(strip.scrollLeft + delta, 0),
      strip.scrollWidth - strip.clientWidth,
    );

    if (nextScrollLeft === strip.scrollLeft) {
      return;
    }

    strip.scrollLeft = nextScrollLeft;
    event.preventDefault();
  }

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

  private normalizedWheelDelta(delta: number, deltaMode: number, pageWidth: number): number {
    switch (deltaMode) {
      case WheelEvent.DOM_DELTA_LINE:
        return delta * 16;
      case WheelEvent.DOM_DELTA_PAGE:
        return delta * pageWidth;
      default:
        return delta;
    }
  }
}
