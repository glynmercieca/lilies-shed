import { Component, computed, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';

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
  ],
  templateUrl: './tool-detail-dialog.html',
  styleUrl: './tool-detail-dialog.scss',
})
export class ToolDetailDialogComponent {
  readonly data = inject<ToolDetailDialogData>(MAT_DIALOG_DATA);
  readonly selectedIndex = signal(0);
  readonly selectedImage = computed(
    () => this.data.tool.images[this.selectedIndex()] ?? '/tool-placeholder.svg',
  );

  setImage(index: number): void {
    this.selectedIndex.set(index);
  }
}
