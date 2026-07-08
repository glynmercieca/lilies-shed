import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ToolWithStatus } from './core/models';
import { fallbackImage } from './core/image-url.util';
import { ResolvedImageDirective } from './core/resolved-image.directive';

type ToolCardMode = 'shed' | 'borrowed' | 'my-tools';

@Component({
  selector: 'app-tool-card',
  imports: [
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatTooltipModule,
    ResolvedImageDirective,
  ],
  templateUrl: './tool-card.html',
  styleUrl: './tool-card.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolCardComponent {
  readonly mode = input.required<ToolCardMode>();
  readonly tool = input.required<ToolWithStatus>();

  readonly view = output<ToolWithStatus>();

  protected readonly fallbackImage = fallbackImage;
  protected readonly showAvailabilityBadge = computed(() => this.mode() !== 'borrowed');
  protected readonly showOwnerChip = computed(() => this.mode() !== 'my-tools');
  protected readonly showBorrowedDateChip = computed(() => this.mode() === 'borrowed');
  protected readonly showBorrowerChip = computed(
    () => this.mode() === 'my-tools' && Boolean(this.tool().activeLoan?.borrowerFirstName),
  );
  protected readonly showAvailabilityChip = computed(
    () => this.mode() === 'my-tools' && !this.tool().activeLoan?.borrowerFirstName,
  );
  private readonly longDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
  });

  private readonly shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  });

  onView(): void {
    this.view.emit(this.tool());
  }

  onViewFromKeyboard(event: Event): void {
    event.preventDefault();
    this.onView();
  }

  formatBorrowedDate(value: string): string {
    return this.formatDate(value, this.shortDateFormatter, 'Date unavailable');
  }

  formatBorrowerLoanDate(value: string): string {
    return this.formatDate(value, this.longDateFormatter, 'Borrow date unavailable');
  }

  private formatDate(
    value: string,
    formatter: Intl.DateTimeFormat,
    fallback: string,
  ): string {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return fallback;
    }

    const parsedDate = new Date(`${normalizedValue}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
      return normalizedValue;
    }

    return formatter.format(parsedDate);
  }
}
