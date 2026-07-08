import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetModule,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';

import { fallbackImage } from './core/image-url.util';
import { ToolWithStatus } from './core/models';
import { ResolvedImageDirective } from './core/resolved-image.directive';

export type ToolSheetMode = 'shed' | 'borrowed' | 'my-tools';
export type ToolSheetAction = 'borrow' | 'return' | 'edit' | 'delete';

export interface ToolSheetData {
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
  private readonly sheetRef = inject(MatBottomSheetRef<ToolSheetComponent, ToolSheetAction>);
  protected readonly fallbackImage = fallbackImage;

  close(): void {
    this.sheetRef.dismiss();
  }

  selectAction(action: ToolSheetAction): void {
    if (this.data.saving) {
      return;
    }

    this.sheetRef.dismiss(action);
  }
}
