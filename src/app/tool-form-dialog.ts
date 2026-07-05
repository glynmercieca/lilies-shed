import { ChangeDetectionStrategy, Component, inject, OnDestroy, signal } from '@angular/core';
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
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { fallbackImage } from './core/image-url.util';
import { ResolvedImageDirective } from './core/resolved-image.directive';
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
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ResolvedImageDirective,
  ],
  templateUrl: './tool-form-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tool-form-dialog.scss',
})
export class ToolFormDialogComponent implements OnDestroy {
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<ToolFormDialogComponent>);
  readonly data = inject<ToolFormDialogData>(MAT_DIALOG_DATA);
  readonly imageUrls = signal<string[]>(this.data.value?.imageUrls ?? []);
  readonly selectedFiles = signal<Array<{ file: File; previewUrl: string }>>([]);
  protected readonly fallbackImage = fallbackImage;

  readonly form = this.formBuilder.nonNullable.group({
    name: [this.data.value?.name ?? '', Validators.required],
    description: [this.data.value?.description ?? '', Validators.required],
    notes: [this.data.value?.notes ?? ''],
  });

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (!files.length) {
      return;
    }

    const nextFiles = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    this.selectedFiles.update((current) => [...current, ...nextFiles]);

    if (input) {
      input.value = '';
    }
  }

  removeExistingImage(index: number): void {
    this.imageUrls.update((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  removeSelectedFile(index: number): void {
    const files = this.selectedFiles();
    const selectedFile = files[index];
    if (selectedFile) {
      URL.revokeObjectURL(selectedFile.previewUrl);
    }

    this.selectedFiles.set(files.filter((_, currentIndex) => currentIndex !== index));
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close({
      ...this.form.getRawValue(),
      imageUrls: this.imageUrls(),
      imageFiles: this.selectedFiles().map((entry) => entry.file),
    });
  }

  ngOnDestroy(): void {
    for (const file of this.selectedFiles()) {
      URL.revokeObjectURL(file.previewUrl);
    }
  }
}
