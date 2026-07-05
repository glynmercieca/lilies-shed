import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';

import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-my-tools-view',
  imports: [MatButtonModule, MatCardModule, MatDividerModule, MatIconModule, MatListModule],
  templateUrl: './my-tools-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsViewComponent {
  readonly state = inject(ToolboxStateService);
}
