import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-privacy-view',
  imports: [MatCardModule],
  templateUrl: './privacy-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class PrivacyViewComponent {}
