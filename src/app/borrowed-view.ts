import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';

import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-borrowed-view',
  imports: [MatButtonModule, MatCardModule, MatDividerModule, MatListModule],
  templateUrl: './borrowed-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BorrowedViewComponent {
  readonly state = inject(ToolboxStateService);
}
