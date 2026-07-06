import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-my-tools-view',
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, MatTooltipModule],
  templateUrl: './my-tools-view.html',
  styleUrl: './my-tools-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsViewComponent {
  readonly state = inject(ToolboxStateService);

  private readonly longDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'long',
  });

  formatLoanDate(value: string): string {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return 'Borrow date unavailable';
    }

    const parsedDate = new Date(`${normalizedValue}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
      return normalizedValue;
    }

    return this.longDateFormatter.format(parsedDate);
  }
}
