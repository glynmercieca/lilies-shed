import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
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
import { MatIconModule } from '@angular/material/icon';

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
    ResolvedImageDirective,
  ],
  templateUrl: './tool-detail-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tool-detail-dialog.scss',
})
export class ToolDetailDialogComponent {
  readonly data = inject<ToolDetailDialogData>(MAT_DIALOG_DATA);
  readonly selectedIndex = signal(0);
  readonly selectedImage = computed(() => this.data.tool.images[this.selectedIndex()] ?? '');
  protected readonly fallbackImage = fallbackImage;

  setImage(index: number): void {
    this.selectedIndex.set(index);
  }
}
