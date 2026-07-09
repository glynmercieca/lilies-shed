import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { ToolboxStateService } from './core/toolbox-state.service';
import { ViewportSentinelDirective } from './core/viewport-sentinel.directive';
import { MyToolsStatSheetComponent, MyToolsStatSheetData } from './my-tools-stat-sheet';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-my-tools-view',
  imports: [
    MatBottomSheetModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ToolCardComponent,
    ViewportSentinelDirective,
  ],
  templateUrl: './my-tools-view.html',
  styleUrl: './my-tools-view.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MyToolsView implements OnDestroy {
  readonly state = inject(ToolboxStateService);
  private activeStatsSheetRef: MatBottomSheetRef<MyToolsStatSheetComponent> | null = null;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly routeSubscription: Subscription;

  constructor() {
    this.routeSubscription = this.route.queryParamMap.subscribe((queryParamMap) => {
      if (queryParamMap.get('sheet') === 'my-tools-stats') {
        this.openStatsSheet();
      } else {
        this.activeStatsSheetRef?.dismiss();
      }
    });
  }

  openStats(): void {
    void this.router.navigate([], {
      queryParams: {
        sheet: 'my-tools-stats',
      },
      queryParamsHandling: 'merge',
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription.unsubscribe();
  }

  private openStatsSheet(): void {
    if (this.activeStatsSheetRef) {
      return;
    }

    const data = this.createStatsData();
    const sheetRef = this.bottomSheet.open(MyToolsStatSheetComponent, {
      autoFocus: false,
      data,
      panelClass: 'rounded-bottom-sheet-panel',
      restoreFocus: false,
    });
    this.activeStatsSheetRef = sheetRef;
    sheetRef.afterDismissed().subscribe(() => {
      if (this.activeStatsSheetRef === sheetRef) {
        this.activeStatsSheetRef = null;
      }

      if (this.route.snapshot.queryParamMap.get('sheet') === 'my-tools-stats') {
        void this.router.navigate([], {
          queryParams: { sheet: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  private createStatsData(): MyToolsStatSheetData {
    const tools = this.state.ownedTools();
    const borrowedTools = tools
      .filter((tool) => tool.activeLoan)
      .map((tool) => ({
        borrowerFirstName: tool.activeLoan?.borrowerFirstName ?? '',
        id: tool.id,
        name: this.formatToolTitle(tool.name),
      }));
    const totalTools = tools.length;
    const borrowedCount = borrowedTools.length;
    const availableCount = totalTools - borrowedCount;
    const borrowedPercent = totalTools ? Math.round((borrowedCount / totalTools) * 100) : 0;
    const donutBackground = totalTools
      ? `conic-gradient(var(--mat-sys-primary) 0 ${borrowedPercent}%, var(--mat-sys-primary-container) ${borrowedPercent}% 100%)`
      : 'conic-gradient(var(--mat-sys-outline-variant) 0 100%)';

    return {
      availableCount,
      borrowedCount,
      borrowedPercent,
      borrowedTools,
      donutBackground,
      totalTools,
    };
  }

  private formatToolTitle(value: string): string {
    return value.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
}
