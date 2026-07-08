import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { ToolboxStateService } from './core/toolbox-state.service';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-my-tools-view',
  imports: [MatButtonModule, MatCardModule, MatIconModule, ToolCardComponent],
  templateUrl: './my-tools-view.html',
  styleUrl: './my-tools-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsView {
  readonly state = inject(ToolboxStateService);
}
