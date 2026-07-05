import { Component, inject } from '@angular/core';
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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { ToolFormValue } from './core/models';

interface ToolFormDialogData {
  mode: 'add' | 'edit';
  value?: ToolFormValue;
}

@Component({
  selector: 'app-tool-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './tool-form-dialog.html',
  styleUrl: './tool-form-dialog.scss',
})
export class ToolFormDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<ToolFormDialogComponent>);
  readonly data = inject<ToolFormDialogData>(MAT_DIALOG_DATA);

  readonly form = this.formBuilder.nonNullable.group({
    name: [this.data.value?.name ?? '', Validators.required],
    description: [this.data.value?.description ?? '', Validators.required],
    notes: [this.data.value?.notes ?? ''],
    images: [this.data.value?.images ?? ''],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close(this.form.getRawValue());
  }
}
