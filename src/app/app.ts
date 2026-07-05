import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { firstValueFrom } from 'rxjs';

import { APP_SETTINGS } from './core/app-settings';
import { GoogleAuthService } from './core/google-auth.service';
import { GoogleSheetsService } from './core/google-sheets.service';
import { LoanRecord, SheetsSnapshot, ToolWithStatus } from './core/models';
import { ToolDetailDialogComponent } from './tool-detail-dialog';
import { ToolFormDialogComponent } from './tool-form-dialog';

type Section = 'tools' | 'borrowed' | 'my-tools';

@Component({
  selector: 'app-root',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressBarModule,
    MatToolbarModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly sheets = inject(GoogleSheetsService);

  readonly auth = inject(GoogleAuthService);
  readonly title = APP_SETTINGS.appName;
  readonly activeSection = signal<Section>('tools');
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly savingToolId = signal<string | null>(null);
  private readonly snapshot = signal<SheetsSnapshot>({ tools: [], loans: [] });

  readonly tools = computed(() => this.decorateTools(this.snapshot()));
  readonly filteredTools = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    return this.tools().filter((tool) => {
      if (!query) {
        return true;
      }

      return [tool.name, tool.description, tool.notes, tool.owner].some((value) =>
        value.toLowerCase().includes(query),
      );
    });
  });
  readonly borrowedTools = computed(() =>
    this.tools().filter((tool) => tool.activeLoan && this.matchesCurrentUser(tool.activeLoan.person)),
  );
  readonly ownedTools = computed(() => this.tools().filter((tool) => this.matchesCurrentUser(tool.owner)));

  constructor() {
    this.lockPortraitOrientation();
  }

  async signIn(): Promise<void> {
    await this.auth.signIn();
    if (this.auth.currentUser()) {
      await this.refresh();
    }
  }

  signOut(): void {
    this.auth.signOut();
    this.snapshot.set({ tools: [], loans: [] });
    this.activeSection.set('tools');
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  async refresh(): Promise<void> {
    const token = this.auth.accessToken();
    if (!token) {
      return;
    }

    this.loading.set(true);
    try {
      const snapshot = await this.sheets.loadSnapshot(token);
      this.snapshot.set(snapshot);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to refresh Google Sheet data.');
    } finally {
      this.loading.set(false);
    }
  }

  async openTool(tool: ToolWithStatus): Promise<void> {
    const dialogRef = this.dialog.open(ToolDetailDialogComponent, {
      data: {
        tool,
        canBorrow: !this.matchesCurrentUser(tool.owner),
      },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result === 'borrow') {
      await this.borrowTool(tool);
    }
  }

  async borrowTool(tool: ToolWithStatus): Promise<void> {
    const token = this.auth.accessToken();
    const user = this.auth.currentUser();
    if (!token || !user || !tool.available) {
      return;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.sheets.addBorrowRequest(token, tool.id, user.name || user.email);
      await this.refresh();
      this.activeSection.set('borrowed');
      this.notify(`Borrow request saved for ${tool.name}.`);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to request this tool.');
    } finally {
      this.savingToolId.set(null);
    }
  }

  async returnTool(tool: ToolWithStatus): Promise<void> {
    const token = this.auth.accessToken();
    if (!token || !tool.activeLoan) {
      return;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.sheets.markReturned(token, tool.activeLoan);
      await this.refresh();
      this.notify(`${tool.name} marked as returned.`);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to mark this tool as returned.');
    } finally {
      this.savingToolId.set(null);
    }
  }

  async addTool(): Promise<void> {
    const token = this.auth.accessToken();
    const user = this.auth.currentUser();
    if (!token || !user) {
      return;
    }

    const dialogRef = this.dialog.open(ToolFormDialogComponent, {
      data: {
        mode: 'add',
      },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result) {
      return;
    }

    this.loading.set(true);
    try {
      await this.sheets.addTool(token, result, user.name || user.email);
      await this.refresh();
      this.notify('Tool added to the sheet.');
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to add a new tool.');
    } finally {
      this.loading.set(false);
    }
  }

  async editTool(tool: ToolWithStatus): Promise<void> {
    const token = this.auth.accessToken();
    if (!token || !tool.available) {
      return;
    }

    const dialogRef = this.dialog.open(ToolFormDialogComponent, {
      data: {
        mode: 'edit',
        value: {
          name: tool.name,
          description: tool.description,
          notes: tool.notes,
          images: tool.images.join('\n'),
        },
      },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result) {
      return;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.sheets.updateTool(token, tool, result);
      await this.refresh();
      this.notify(`${tool.name} updated.`);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to update this tool.');
    } finally {
      this.savingToolId.set(null);
    }
  }

  private decorateTools(snapshot: SheetsSnapshot): ToolWithStatus[] {
    const activeLoanByTool = new Map<string, LoanRecord>();
    const latestLoanByTool = new Map<string, LoanRecord>();

    for (const loan of snapshot.loans) {
      latestLoanByTool.set(loan.itemId, loan);
      if (!loan.returnDate) {
        activeLoanByTool.set(loan.itemId, loan);
      }
    }

    return snapshot.tools.map((tool) => ({
      ...tool,
      activeLoan: activeLoanByTool.get(tool.id),
      latestLoan: latestLoanByTool.get(tool.id),
      available: !activeLoanByTool.has(tool.id),
    }));
  }

  private matchesCurrentUser(value: string): boolean {
    const user = this.auth.currentUser();
    if (!user || !value) {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === user.email.trim().toLowerCase() || normalized === user.name.trim().toLowerCase();
  }

  private notify(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 4000 });
  }

  private async lockPortraitOrientation(): Promise<void> {
    const screenOrientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    };
    if (!screenOrientation?.lock) {
      return;
    }

    try {
      await screenOrientation.lock('portrait');
    } catch {
      // Browsers may block orientation locking outside installed app contexts.
    }
  }
}
