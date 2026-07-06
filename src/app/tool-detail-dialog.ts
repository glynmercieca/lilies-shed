import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogRef,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { fallbackImage } from './core/image-url.util';
import { ResolvedImageDirective } from './core/resolved-image.directive';
import { ToolWithStatus } from './core/models';

interface ToolDetailDialogData {
  canBorrow: boolean;
  tool: ToolWithStatus;
}

@Component({
  selector: 'app-tool-detail-dialog',
  imports: [
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ResolvedImageDirective,
  ],
  templateUrl: './tool-detail-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tool-detail-dialog.scss',
})
export class ToolDetailDialogComponent {
  readonly data = inject<ToolDetailDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<ToolDetailDialogComponent>);
  readonly borrowRequested = new Subject<void>();
  readonly saving = signal(false);
  protected readonly fallbackImage = fallbackImage;

  requestBorrow(): void {
    if (this.saving()) {
      return;
    }

    this.borrowRequested.next();
  }

  setSaving(saving: boolean): void {
    this.saving.set(saving);
    this.dialogRef.disableClose = saving;
  }
}
