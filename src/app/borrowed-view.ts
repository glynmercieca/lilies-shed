import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { BorrowedStatSheetComponent } from './borrowed-stat-sheet';
import { ToolboxStateService } from './core/toolbox-state.service';
import { ViewportSentinelDirective } from './core/viewport-sentinel.directive';
import { ToolCardComponent } from './tool-card';

@Component({
  selector: 'app-borrowed-view',
  imports: [
    MatBottomSheetModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ToolCardComponent,
    ViewportSentinelDirective,
  ],
  templateUrl: './borrowed-view.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BorrowedViewComponent implements OnDestroy {
  readonly state = inject(ToolboxStateService);
  private activeStatsSheetRef: MatBottomSheetRef<BorrowedStatSheetComponent> | null = null;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly routeSubscription: Subscription;

  constructor() {
    this.routeSubscription = this.route.queryParamMap.subscribe((queryParamMap) => {
      if (queryParamMap.get('sheet') === 'borrowed-stats') {
        this.openStatsSheet();
      } else {
        this.activeStatsSheetRef?.dismiss();
      }
    });
  }

  get borrowedToolsSummary(): string {
    const count = this.state.borrowedTools().length;
    return `${count} borrowed ${count === 1 ? 'tool' : 'tools'}`;
  }

  openStats(): void {
    void this.router.navigate([], {
      queryParams: {
        sheet: 'borrowed-stats',
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

    const sheetRef = this.bottomSheet.open(BorrowedStatSheetComponent, {
      data: {
        tools: this.state.borrowedTools(),
      },
      panelClass: 'rounded-bottom-sheet-panel',
    });
    this.activeStatsSheetRef = sheetRef;
    sheetRef.afterDismissed().subscribe(() => {
      if (this.activeStatsSheetRef === sheetRef) {
        this.activeStatsSheetRef = null;
      }

      if (this.route.snapshot.queryParamMap.get('sheet') === 'borrowed-stats') {
        void this.router.navigate([], {
          queryParams: { sheet: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }
}
