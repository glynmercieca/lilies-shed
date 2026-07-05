import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { GoogleAuthService } from './google-auth.service';
import { GoogleSheetsService } from './google-sheets.service';
import { formatUserIdentity, matchesUserIdentity } from './identity.util';
import { SheetsSnapshot, ToolWithStatus } from './models';
import { decorateTools } from './tool-status.util';
import { ToolDetailDialogComponent } from '../tool-detail-dialog';
import { ToolFormDialogComponent } from '../tool-form-dialog';

@Injectable({ providedIn: 'root' })
export class ToolboxStateService {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly sheets = inject(GoogleSheetsService);
  private readonly router = inject(Router);

  readonly auth = inject(GoogleAuthService);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly showUnavailableTools = signal(false);
  readonly savingToolId = signal<string | null>(null);
  private readonly snapshot = signal<SheetsSnapshot>({ tools: [], loans: [] });
  private readonly loadedUserEmail = signal<string | null>(null);

  readonly tools = computed(() => decorateTools(this.snapshot()));
  readonly filteredTools = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    return this.tools().filter((tool) => {
      if (!this.showUnavailableTools() && !tool.available) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [tool.name, tool.description, tool.notes, tool.owner].some((value) =>
        value.toLowerCase().includes(query),
      );
    });
  });
  readonly borrowedTools = computed(() =>
    this.tools().filter(
      (tool) => tool.activeLoan && matchesUserIdentity(this.auth.currentUser(), tool.activeLoan.person),
    ),
  );
  readonly ownedTools = computed(() =>
    this.tools().filter((tool) => matchesUserIdentity(this.auth.currentUser(), tool.owner)),
  );

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const loadedUserEmail = this.loadedUserEmail();

      if (!user) {
        if (loadedUserEmail) {
          this.snapshot.set({ tools: [], loans: [] });
          this.loadedUserEmail.set(null);
        }
        return;
      }

      if (loadedUserEmail === user.email) {
        return;
      }

      this.loadedUserEmail.set(user.email);
      void this.refresh();
    });
  }

  async signIn(): Promise<void> {
    await this.auth.signIn();
    if (this.auth.currentUser()) {
      await this.refresh();
      await this.router.navigate(['/tools']);
    }
  }

  async signOut(): Promise<void> {
    this.auth.signOut();
    this.snapshot.set({ tools: [], loans: [] });
    this.searchTerm.set('');
    this.loadedUserEmail.set(null);
    await this.router.navigate(['/']);
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  setShowUnavailableTools(value: boolean): void {
    this.showUnavailableTools.set(value);
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
        canBorrow: !matchesUserIdentity(this.auth.currentUser(), tool.owner),
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
      await this.sheets.addBorrowRequest(token, tool.id, formatUserIdentity(user));
      await this.refresh();
      await this.router.navigate(['/borrowed']);
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
      data: { mode: 'add' },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result) {
      return;
    }

    this.loading.set(true);
    try {
      await this.sheets.addTool(token, result, formatUserIdentity(user));
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

  private notify(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 4000 });
  }
}
