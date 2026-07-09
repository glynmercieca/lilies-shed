import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ToolboxStateService } from './core/toolbox-state.service';
import { ViewportSentinelDirective } from './core/viewport-sentinel.directive';
import { MyToolsStatSheetComponent, MyToolsStatSheetData } from './my-tools-stat-sheet';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-my-tools-view',
  imports: [
    MatBottomSheetModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ToolCardComponent,
    ViewportSentinelDirective,
  ],
  templateUrl: './my-tools-view.html',
  styleUrl: './my-tools-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsView {
  readonly state = inject(ToolboxStateService);
  private readonly bottomSheet = inject(MatBottomSheet);

  openStats(): void {
    const data = this.createStatsData();
    this.bottomSheet.open(MyToolsStatSheetComponent, {
      autoFocus: false,
      data,
      panelClass: 'rounded-bottom-sheet-panel',
      restoreFocus: false,
    });
  }

  private createStatsData(): MyToolsStatSheetData {
    const tools = this.state.ownedTools();
    const borrowedTools = tools
      .filter((tool) => tool.activeLoan)
      .map((tool) => ({
        borrowerFirstName: tool.activeLoan?.borrowerFirstName ?? '',
        id: tool.id,
        name: this.formatToolTitle(tool.name),
      }));
    const totalTools = tools.length;
    const borrowedCount = borrowedTools.length;
    const availableCount = totalTools - borrowedCount;
    const borrowedPercent = totalTools ? Math.round((borrowedCount / totalTools) * 100) : 0;
    const donutBackground = totalTools
      ? `conic-gradient(var(--mat-sys-primary) 0 ${borrowedPercent}%, var(--mat-sys-primary-container) ${borrowedPercent}% 100%)`
      : 'conic-gradient(var(--mat-sys-outline-variant) 0 100%)';

    return {
      availableCount,
      borrowedCount,
      borrowedPercent,
      borrowedTools,
      donutBackground,
      totalTools,
    };
  }

  private formatToolTitle(value: string): string {
    return value.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
}
