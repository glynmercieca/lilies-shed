import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { BorrowedStatSheetComponent } from './borrowed-stat-sheet';
import { ToolboxStateService } from './core/toolbox-state.service';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-borrowed-view',
  imports: [MatBottomSheetModule, MatButtonModule, MatCardModule, MatIconModule, ToolCardComponent],
  templateUrl: './borrowed-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BorrowedViewComponent {
  readonly state = inject(ToolboxStateService);
  private readonly bottomSheet = inject(MatBottomSheet);

  get borrowedToolsSummary(): string {
    const count = this.state.borrowedTools().length;
    return `${count} borrowed ${count === 1 ? 'tool' : 'tools'}`;
  }

  openStats(): void {
    this.bottomSheet.open(BorrowedStatSheetComponent, {
      data: {
        tools: this.state.borrowedTools(),
      },
      panelClass: 'rounded-bottom-sheet-panel',
    });
  }
}
