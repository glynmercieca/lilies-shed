import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-about-view',
  templateUrl: './about-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AboutViewComponent {}
