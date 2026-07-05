import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { ToolboxStateService } from './core/toolbox-state.service';

@Component({
  selector: 'app-tools-view',
  imports: [MatButtonModule, MatCardModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule],
  templateUrl: './tools-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolsViewComponent {
  readonly state = inject(ToolboxStateService);
}
