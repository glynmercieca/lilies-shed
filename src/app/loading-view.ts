import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-loading-view',
  imports: [MatProgressSpinnerModule],
  templateUrl: './loading-view.html',
  styleUrl: './loading-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class LoadingViewComponent {}
