import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { ResolvedImageDirective } from './core/resolved-image.directive';

export interface ToolImagePreviewDialogData {
  alt: string;
  image: string;
}

@Component({
  selector: 'app-tool-image-preview-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, ResolvedImageDirective],
  templateUrl: './tool-image-preview-dialog.html',
  styleUrl: './tool-image-preview-dialog.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ToolImagePreviewDialogComponent {
  readonly data = inject<ToolImagePreviewDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ToolImagePreviewDialogComponent>);
  protected readonly previewScale = signal(1);
  protected readonly previewTranslateX = signal(0);
  protected readonly previewTranslateY = signal(0);
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private initialPinchDistance = 0;
  private initialPinchScale = 1;
  private dragStart: { x: number; y: number; translateX: number; translateY: number } | null = null;

  close(): void {
    this.dialogRef.close();
  }

  onPreviewPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    if (this.activePointers.size === 2) {
      this.initialPinchDistance = this.getPointerDistance();
      this.initialPinchScale = this.previewScale();
      this.dragStart = null;
      return;
    }

    if (this.previewScale() > 1) {
      this.dragStart = {
        x: event.clientX,
        y: event.clientY,
        translateX: this.previewTranslateX(),
        translateY: this.previewTranslateY(),
      };
    }
  }

  onPreviewPointerMove(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.activePointers.size === 2 && this.initialPinchDistance > 0) {
      const nextScale = this.clampScale(
        this.initialPinchScale * (this.getPointerDistance() / this.initialPinchDistance),
      );
      this.previewScale.set(nextScale);
      if (nextScale === 1) {
        this.previewTranslateX.set(0);
        this.previewTranslateY.set(0);
      }
      return;
    }

    if (!this.dragStart || this.previewScale() <= 1) {
      return;
    }

    this.previewTranslateX.set(this.dragStart.translateX + event.clientX - this.dragStart.x);
    this.previewTranslateY.set(this.dragStart.translateY + event.clientY - this.dragStart.y);
  }

  onPreviewPointerEnd(event: PointerEvent): void {
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size < 2) {
      this.initialPinchDistance = 0;
      this.initialPinchScale = this.previewScale();
    }

    if (this.previewScale() <= 1) {
      this.resetPreviewTransform();
    }
  }

  onPreviewWheel(event: WheelEvent): void {
    event.preventDefault();
    const nextScale = this.clampScale(this.previewScale() + (event.deltaY < 0 ? 0.2 : -0.2));
    this.previewScale.set(nextScale);
    if (nextScale === 1) {
      this.previewTranslateX.set(0);
      this.previewTranslateY.set(0);
    }
  }

  private resetPreviewTransform(): void {
    this.previewScale.set(1);
    this.previewTranslateX.set(0);
    this.previewTranslateY.set(0);
  }

  private getPointerDistance(): number {
    const pointers = [...this.activePointers.values()];
    if (pointers.length < 2) {
      return 0;
    }

    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  }

  private clampScale(value: number): number {
    return Math.min(4, Math.max(1, value));
  }
}
