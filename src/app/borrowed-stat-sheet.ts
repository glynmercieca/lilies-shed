import { TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetModule,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';

import { ToolWithStatus } from './core/models';

interface BorrowedStatSheetData {
  tools: ToolWithStatus[];
}

interface OwnerStat {
  count: number;
  name: string;
  percent: number;
}

@Component({
  selector: 'app-borrowed-stat-sheet',
  imports: [
    MatBottomSheetModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    TitleCasePipe,
  ],
  templateUrl: './borrowed-stat-sheet.html',
  styleUrl: './borrowed-stat-sheet.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BorrowedStatSheetComponent {
  readonly data = inject<BorrowedStatSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly sheetRef = inject(MatBottomSheetRef<BorrowedStatSheetComponent>);

  protected readonly totalTools = computed(() => this.data.tools.length);
  protected readonly ownerStats = computed(() => {
    const totals = new Map<string, number>();
    for (const tool of this.data.tools) {
      const owner = tool.ownerFirstName || tool.owner || 'Unknown owner';
      totals.set(owner, (totals.get(owner) ?? 0) + 1);
    }

    const total = this.totalTools();
    return Array.from(totals.entries())
      .map(([name, count]): OwnerStat => ({
        count,
        name,
        percent: total ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });
  protected readonly uniqueOwnerCount = computed(() => this.ownerStats().length);
  protected readonly averageDaysBorrowed = computed(() => {
    const ages = this.data.tools
      .map((tool) => this.daysSince(tool.activeLoan?.loanDate ?? ''))
      .filter((value): value is number => value !== null);

    if (!ages.length) {
      return 0;
    }

    return Math.round(ages.reduce((total, value) => total + value, 0) / ages.length);
  });
  protected readonly newestBorrowedTool = computed(() =>
    [...this.data.tools].sort((first, second) =>
      this.dateValue(second.activeLoan?.loanDate ?? '') - this.dateValue(first.activeLoan?.loanDate ?? ''),
    )[0],
  );

  close(): void {
    this.sheetRef.dismiss();
  }

  protected formatBorrowedDate(value: string): string {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return 'Date unavailable';
    }

    const parsedDate = new Date(`${normalizedValue}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
      return normalizedValue;
    }

    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsedDate);
  }

  private daysSince(value: string): number | null {
    const timestamp = this.dateValue(value);
    if (!timestamp) {
      return null;
    }

    const elapsedMs = Date.now() - timestamp;
    return Math.max(0, Math.floor(elapsedMs / 86_400_000));
  }

  private dateValue(value: string): number {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return 0;
    }

    const timestamp = new Date(`${normalizedValue}T00:00:00`).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}
