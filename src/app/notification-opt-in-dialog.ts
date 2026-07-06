import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-notification-opt-in-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButtonModule],
  templateUrl: './notification-opt-in-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class NotificationOptInDialogComponent {}
