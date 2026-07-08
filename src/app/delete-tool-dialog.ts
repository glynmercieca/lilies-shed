import { TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

interface DeleteToolDialogData {
  toolId: string;
  toolName: string;
}

@Component({
  selector: 'app-delete-tool-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    TitleCasePipe,
  ],
  templateUrl: './delete-tool-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DeleteToolDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<DeleteToolDialogComponent>);
  readonly data = inject<DeleteToolDialogData>(MAT_DIALOG_DATA);

  readonly form = this.formBuilder.nonNullable.group({
    toolId: ['', [Validators.required, Validators.pattern(this.escapeRegExp(this.data.toolId))]],
  });

  confirm(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close(true);
  }

  private escapeRegExp(value: string): string {
    return `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  }
}
