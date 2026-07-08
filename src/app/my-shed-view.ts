import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ToolboxStateService } from './core/toolbox-state.service';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-my-shed-view',
  imports: [MatCardModule, MatIconModule, ToolCardComponent],
  templateUrl: './my-shed-view.html',
  styleUrl: './my-shed-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyShedViewComponent {
  readonly state = inject(ToolboxStateService);
}
