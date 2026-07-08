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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Subject, Subscription } from 'rxjs';

import { fallbackImage } from './core/image-url.util';
import { ResolvedImageDirective } from './core/resolved-image.directive';
import { ToolCategoryRecord, ToolFormValue } from './core/models';

interface ToolFormDialogData {
  categories: ToolCategoryRecord[];
  mode: 'add' | 'edit';
  value?: ToolFormValue;
}

const MAX_IMAGE_FILE_SIZE_BYTES = 32 * 1024 * 1024;
const CATEGORY_NAME_MATCHERS: ReadonlyArray<{ categoryId: string; terms: readonly string[] }> = [
  {
    categoryId: 'automotive',
    terms: ['obd', 'odb', 'jump starter', 'battery charger', 'torque wrench', 'axle stand', 'car jack'],
  },
  {
    categoryId: 'measuring-layout',
    terms: ['tape measure', 'vernier', 'caliper', 'calliper', 'level', 'laser', 'square', 'ruler', 'measure'],
  },
  {
    categoryId: 'electrical',
    terms: ['ethernet', 'network', 'multimeter', 'clamp meter', 'tester', 'test kit', 'extension lead', 'cable', 'wire stripper', 'crimper', 'soldering', 'solder', 'welder', 'flood light'],
  },
  {
    categoryId: 'plumbing',
    terms: ['pipe', 'plunger', 'basin', 'tap', 'drain', 'pipe cutter', 'spring bender'],
  },
  {
    categoryId: 'hand-tools',
    terms: ['threading', 'screwdriver', 'hammer', 'spanner', 'wrench', 'pliers', 'clamp', 'chisel', 'file', 'socket', 'ratchet', 'miter box', 'mitre box', 'mither box'],
  },
  {
    categoryId: 'power-tools',
    terms: ['drill', 'impact driver', 'saw', 'sander', 'grinder', 'jigsaw', 'router', 'multitool', 'heat gun', 'nail gun'],
  },
  {
    categoryId: 'garden-outdoor',
    terms: ['mower', 'trimmer', 'strimmer', 'rake', 'shovel', 'spade', 'hoe', 'shears', 'hose', 'sprayer'],
  },
  {
    categoryId: 'ladders-access',
    terms: ['ladder', 'steps', 'step ladder', 'scaffold', 'platform'],
  },
  {
    categoryId: 'painting-decorating',
    terms: ['paint', 'brush', 'roller', 'tray', 'scraper', 'wallpaper', 'decorating'],
  },
  {
    categoryId: 'safety',
    terms: ['gloves', 'goggles', 'mask', 'respirator', 'helmet', 'ear defenders', 'knee pads'],
  },
  {
    categoryId: 'cleaning',
    terms: ['vacuum', 'washer', 'pressure washer', 'mop', 'bucket', 'broom', 'cleaner', 'air duster'],
  },
];

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
    MatProgressSpinnerModule,
    MatSelectModule,
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
  readonly imageUrl = signal(this.data.value?.imageUrl ?? '');
  readonly selectedFile = signal<{ file: File; previewUrl: string } | null>(null);
  readonly imageSelectionError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly submitRequested = new Subject<ToolFormValue>();
  private categoryEditedByUser = false;
  private nameChangesSubscription: Subscription;
  protected readonly categories = this.data.categories;
  protected readonly fallbackImage = fallbackImage;
  protected readonly maxImageSizeMb = 32;

  readonly form = this.formBuilder.nonNullable.group({
    name: [this.data.value?.name ?? '', Validators.required],
    categoryId: [this.data.value?.categoryId ?? '', Validators.required],
    description: [this.data.value?.description ?? '', Validators.required],
    notes: [this.data.value?.notes ?? ''],
  });

  constructor() {
    this.nameChangesSubscription = this.form.controls.name.valueChanges.subscribe((name) => {
      this.applyDetectedCategory(name);
    });

    this.applyDetectedCategory(this.form.controls.name.value);
  }

  onCategoryOpenedChange(opened: boolean): void {
    if (opened) {
      this.categoryEditedByUser = true;
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (!files.length) {
      return;
    }

    const oversizedFiles = files.filter((file) => file.size > MAX_IMAGE_FILE_SIZE_BYTES);
    const allowedFiles = files.filter((file) => file.size <= MAX_IMAGE_FILE_SIZE_BYTES);

    if (oversizedFiles.length) {
      const fileList = oversizedFiles.map((file) => file.name || 'Unnamed image').join(', ');
      this.imageSelectionError.set(`Images must be ${this.maxImageSizeMb} MB or smaller. Skipped: ${fileList}.`);
    } else {
      this.imageSelectionError.set(null);
    }

    if (!allowedFiles.length) {
      if (input) {
        input.value = '';
      }
      return;
    }

    const nextFile = allowedFiles[0];
    const currentSelectedFile = this.selectedFile();
    if (currentSelectedFile) {
      URL.revokeObjectURL(currentSelectedFile.previewUrl);
    }

    this.selectedFile.set({
      file: nextFile,
      previewUrl: URL.createObjectURL(nextFile),
    });

    if (input) {
      input.value = '';
    }
  }

  removeExistingImage(): void {
    if (this.saving()) {
      return;
    }

    this.imageUrl.set('');
  }

  removeSelectedFile(): void {
    if (this.saving()) {
      return;
    }

    const selectedFile = this.selectedFile();
    if (selectedFile) {
      URL.revokeObjectURL(selectedFile.previewUrl);
    }

    this.selectedFile.set(null);
  }

  submit(): void {
    if (this.saving()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.imageSelectionError()) {
      return;
    }

    this.submitRequested.next({
      ...this.form.getRawValue(),
      imageUrl: this.imageUrl(),
      imageFile: this.selectedFile()?.file ?? null,
    });
  }

  setSaving(saving: boolean): void {
    this.saving.set(saving);
    this.dialogRef.disableClose = saving;

    if (saving) {
      this.form.disable({ emitEvent: false });
      return;
    }

    this.form.enable({ emitEvent: false });
  }

  ngOnDestroy(): void {
    this.submitRequested.complete();
    this.nameChangesSubscription.unsubscribe();

    const selectedFile = this.selectedFile();
    if (selectedFile) {
      URL.revokeObjectURL(selectedFile.previewUrl);
    }
  }

  private applyDetectedCategory(name: string): void {
    if (this.data.mode !== 'add' || this.categoryEditedByUser) {
      return;
    }

    const categoryId = this.detectCategoryId(name);
    if (!categoryId) {
      return;
    }

    this.form.controls.categoryId.setValue(categoryId, { emitEvent: false });
  }

  private detectCategoryId(name: string): string | null {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
      return null;
    }

    const availableCategoryIds = new Set(this.categories.map((category) => category.id));
    const match = CATEGORY_NAME_MATCHERS.find(
      (matcher) =>
        availableCategoryIds.has(matcher.categoryId) &&
        matcher.terms.some((term) => normalizedName.includes(term)),
    );

    return match?.categoryId ?? null;
  }
}
