import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ToolboxStateService } from './core/toolbox-state.service';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-borrowed-view',
  imports: [MatCardModule, MatIconModule, ToolCardComponent],
  templateUrl: './borrowed-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BorrowedViewComponent {
  readonly state = inject(ToolboxStateService);
}
