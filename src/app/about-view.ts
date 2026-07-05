import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-about-view',
  imports: [MatCardModule],
  templateUrl: './about-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AboutViewComponent {}
