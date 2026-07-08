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

interface MyToolsStatSheetData {
  tools: ToolWithStatus[];
}

@Component({
  selector: 'app-my-tools-stat-sheet',
  imports: [
    MatBottomSheetModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    TitleCasePipe,
  ],
  templateUrl: './my-tools-stat-sheet.html',
  styleUrl: './my-tools-stat-sheet.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsStatSheetComponent {
  readonly data = inject<MyToolsStatSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly sheetRef = inject(MatBottomSheetRef<MyToolsStatSheetComponent>);

  protected readonly totalTools = computed(() => this.data.tools.length);
  protected readonly borrowedTools = computed(() => this.data.tools.filter((tool) => tool.activeLoan));
  protected readonly borrowedCount = computed(() => this.borrowedTools().length);
  protected readonly availableCount = computed(() => this.totalTools() - this.borrowedCount());
  protected readonly borrowedPercent = computed(() => {
    const total = this.totalTools();
    return total ? Math.round((this.borrowedCount() / total) * 100) : 0;
  });
  protected readonly donutBackground = computed(() => {
    const borrowed = this.borrowedPercent();
    if (!this.totalTools()) {
      return 'conic-gradient(var(--mat-sys-outline-variant) 0 100%)';
    }

    return `conic-gradient(var(--mat-sys-primary) 0 ${borrowed}%, var(--mat-sys-primary-container) ${borrowed}% 100%)`;
  });

  close(): void {
    this.sheetRef.dismiss();
  }
}
