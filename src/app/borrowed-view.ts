import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';

import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-borrowed-view',
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatIconModule],
  templateUrl: './borrowed-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BorrowedViewComponent {
  readonly state = inject(ToolboxStateService);
}
