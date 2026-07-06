import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

interface ReturnToolDialogData {
  toolName: string;
}

@Component({
  selector: 'app-return-tool-dialog',
  imports: [MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle, MatButtonModule],
  templateUrl: './return-tool-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ReturnToolDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ReturnToolDialogComponent>);
  readonly data = inject<ReturnToolDialogData>(MAT_DIALOG_DATA);

  confirm(): void {
    this.dialogRef.close(true);
  }
}
