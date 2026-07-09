import { AfterViewInit, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetModule,
  MatBottomSheetRef,
} from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export interface MyToolsStatSheetData {
  availableCount: number;
  borrowedCount: number;
  borrowedPercent: number;
  borrowedTools: Array<{
    borrowerFirstName: string;
    id: string;
    name: string;
  }>;
  donutBackground: string;
  totalTools: number;
}

@Component({
  selector: 'app-my-tools-stat-sheet',
  imports: [
    MatBottomSheetModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './my-tools-stat-sheet.html',
  styleUrl: './my-tools-stat-sheet.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsStatSheetComponent implements AfterViewInit {
  readonly data = inject<MyToolsStatSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly sheetRef = inject(MatBottomSheetRef<MyToolsStatSheetComponent>);

  protected readonly contentReady = signal(false);

  close(): void {
    this.sheetRef.dismiss();
  }

  ngAfterViewInit(): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => this.contentReady.set(true));
    });
  }
}
