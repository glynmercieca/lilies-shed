import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ToolboxStateService } from './core/toolbox-state.service';
import { MyToolsStatSheetComponent } from './my-tools-stat-sheet';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-my-tools-view',
  imports: [MatBottomSheetModule, MatButtonModule, MatCardModule, MatIconModule, ToolCardComponent],
  templateUrl: './my-tools-view.html',
  styleUrl: './my-tools-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsView {
  readonly state = inject(ToolboxStateService);
  private readonly bottomSheet = inject(MatBottomSheet);

  openStats(): void {
    this.bottomSheet.open(MyToolsStatSheetComponent, {
      data: {
        tools: this.state.ownedTools(),
      },
      panelClass: 'rounded-bottom-sheet-panel',
    });
  }
}
