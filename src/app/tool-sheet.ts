import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetModule,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Subject } from 'rxjs';

import { TOOL_PLACEHOLDER_URL, fallbackImage, normalizeImageUrl } from './core/image-url.util';
import { ToolWithStatus } from './core/models';
import { ResolvedImageDirective } from './core/resolved-image.directive';
import { ToolImagePreviewDialogComponent } from './tool-image-preview-dialog';

export type ToolSheetMode = 'shed' | 'borrowed' | 'my-tools';
export type ToolSheetAction = 'borrow' | 'return' | 'edit' | 'delete';

export interface ToolSheetData {
  actionRequested: Subject<ToolSheetAction>;
  canBorrow: boolean;
  mode: ToolSheetMode;
  saving: boolean;
  tool: ToolWithStatus;
}

@Component({
  selector: 'app-tool-sheet',
  imports: [
    MatBottomSheetModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    ResolvedImageDirective,
  ],
  templateUrl: './tool-sheet.html',
  styleUrl: './tool-sheet.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolSheetComponent {
  readonly data = inject<ToolSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly dialog = inject(MatDialog);
  private readonly sheetRef = inject(MatBottomSheetRef<ToolSheetComponent, ToolSheetAction>);
  protected readonly fallbackImage = fallbackImage;
  private readonly borrowedDateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  });
  protected readonly canPreviewImage = computed(() => {
    const imageUrl = normalizeImageUrl(this.data.tool.image || '');
    return Boolean(imageUrl && imageUrl !== TOOL_PLACEHOLDER_URL);
  });
  protected readonly showBorrowedDateChip = computed(() =>
    Boolean(this.data.tool.activeLoan?.loanDate)
    && (this.data.mode === 'borrowed' || this.data.mode === 'my-tools'),
  );

  close(): void {
    this.sheetRef.dismiss();
  }

  openImagePreview(): void {
    if (!this.canPreviewImage()) {
      return;
    }

    this.dialog.open(ToolImagePreviewDialogComponent, {
      autoFocus: false,
      data: {
        alt: this.data.tool.name,
        image: this.data.tool.image,
      },
      height: '100dvh',
      maxHeight: '100dvh',
      maxWidth: '100vw',
      panelClass: 'tool-image-preview-dialog-panel',
      width: '100vw',
    });
  }

  onPreviewKeyboard(event: Event): void {
    event.preventDefault();
    this.openImagePreview();
  }

  formatBorrowedDate(value: string): string {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return 'Date unavailable';
    }

    const parsedDate = new Date(`${normalizedValue}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) {
      return normalizedValue;
    }

    return this.borrowedDateFormatter.format(parsedDate);
  }

  selectAction(action: ToolSheetAction): void {
    if (this.data.saving) {
      return;
    }

    this.data.actionRequested.next(action);
  }
}
