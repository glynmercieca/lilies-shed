import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';

import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { FirestoreToolboxService } from './firestore-toolbox.service';
import { ImageUploadService } from './image-upload.service';
import { APP_SETTINGS } from './app-settings';
import { matchesUserId } from './identity.util';
import { SheetsSnapshot, ToolWithStatus } from './models';
import { decorateTools } from './tool-status.util';
import { ToolDetailDialogComponent } from '../tool-detail-dialog';
import { DeleteToolDialogComponent } from '../delete-tool-dialog';
import { NotificationOptInDialogComponent } from '../notification-opt-in-dialog';
import { RequestToolDialogComponent } from '../request-tool-dialog';
import { ReturnToolDialogComponent } from '../return-tool-dialog';
import { ToolFormDialogComponent } from '../tool-form-dialog';

@Injectable({ providedIn: 'root' })
export class ToolboxStateService {
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly toolbox = inject(FirestoreToolboxService);
  private readonly messaging = inject(FirebaseMessagingService);
  private readonly imageUpload = inject(ImageUploadService);
  private readonly router = inject(Router);

  readonly auth = inject(FirebaseAuthService);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly savingToolId = signal<string | null>(null);
  private readonly snapshot = signal<SheetsSnapshot>({ tools: [], loans: [], notifications: [] });
  private readonly loadedUserEmail = signal<string | null>(null);

  readonly tools = computed(() => decorateTools(this.snapshot()));
  readonly visibleTools = computed(() => this.tools().filter((tool) => !tool.deleted));
  readonly filteredTools = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    return this.visibleTools().filter((tool) => {
      if (!tool.available) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [tool.name, tool.description, tool.notes, tool.owner].some((value) => value.toLowerCase().includes(query));
    });
  });
  readonly borrowedTools = computed(() =>
    this.visibleTools().filter(
      (tool) => tool.activeLoan && matchesUserId(this.auth.currentUser(), tool.activeLoan.borrowerId),
    ),
  );
  readonly ownedTools = computed(() => this.visibleTools().filter((tool) => matchesUserId(this.auth.currentUser(), tool.ownerId)));
  readonly recentNotifications = computed(() =>
    this.snapshot()
      .notifications.filter((notification) => !notification.recipientId || matchesUserId(this.auth.currentUser(), notification.recipientId))
      .slice(0, 10),
  );

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const loadedUserEmail = this.loadedUserEmail();

      if (!user) {
        if (loadedUserEmail) {
          this.snapshot.set({ tools: [], loans: [], notifications: [] });
          this.loadedUserEmail.set(null);
        }
        return;
      }

      if (loadedUserEmail === user.email) {
        return;
      }

      this.loadedUserEmail.set(user.email);
      void this.refresh();
      void this.messaging.syncCurrentUser(user);
    });
  }

  async signIn(): Promise<void> {
    await this.auth.signIn();
    const user = this.auth.currentUser();
    if (user) {
      const shouldPromptForNotifications = await this.messaging.canPromptForNotifications();
      if (shouldPromptForNotifications) {
        const dialogRef = this.dialog.open(NotificationOptInDialogComponent, {
          maxWidth: '480px',
          width: 'min(92vw, 480px)',
        });
        const choice = await firstValueFrom(dialogRef.afterClosed());
        await this.messaging.syncCurrentUser(user, { requestPermission: choice === 'enable' });
      } else {
        await this.messaging.syncCurrentUser(user);
      }
      await this.refresh();
      await this.router.navigate(['/shed']);
    }
  }

  async signOut(): Promise<void> {
    const user = this.auth.currentUser();
    if (user) {
      await this.messaging.clearCurrentUserToken(user.id);
    }
    await this.auth.signOut();
    this.snapshot.set({ tools: [], loans: [], notifications: [] });
    this.searchTerm.set('');
    this.loadedUserEmail.set(null);
    await this.router.navigate(['/']);
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  async refresh(): Promise<void> {
    if (!(await this.auth.ensureValidSession())) {
      return;
    }

    this.loading.set(true);
    try {
      const snapshot = await this.toolbox.loadSnapshot();
      this.snapshot.set(snapshot);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to refresh toolbox data.');
    } finally {
      this.loading.set(false);
    }
  }

  async openTool(tool: ToolWithStatus): Promise<void> {
    const dialogRef = this.dialog.open(ToolDetailDialogComponent, {
      data: {
        tool,
        canBorrow: !matchesUserId(this.auth.currentUser(), tool.ownerId),
      },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });
    const component = dialogRef.componentInstance;
    if (!component) {
      return;
    }

    let borrowSubscription: Subscription | null = null;
    borrowSubscription = component.borrowRequested.subscribe(async () => {
      const user = this.auth.currentUser();
      if (!user || !tool.available || component.saving()) {
        return;
      }

      component.setSaving(true);
      this.savingToolId.set(tool.id);

      try {
        await this.toolbox.addBorrowRequest(tool.documentId, user);
        await this.refresh();
        dialogRef.close(true);
        await this.router.navigate(['/borrowed']);
        this.notify(`Borrow request saved for ${tool.name}.`);
      } catch (error) {
        component.setSaving(false);
        this.notify(error instanceof Error ? error.message : 'Unable to request this tool.');
      } finally {
        this.savingToolId.set(null);
      }
    });

    dialogRef.afterClosed().subscribe(() => borrowSubscription?.unsubscribe());
  }

  async borrowTool(tool: ToolWithStatus): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !tool.available) {
      return;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.toolbox.addBorrowRequest(tool.documentId, user);
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
    if (!tool.activeLoan) {
      return;
    }

    const dialogRef = this.dialog.open(ReturnToolDialogComponent, {
      data: {
        toolName: tool.name,
      },
      maxWidth: '420px',
      width: 'min(92vw, 420px)',
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.toolbox.markReturned(tool.activeLoan);
      await this.refresh();
      this.notify(`${tool.name} marked as returned.`);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to mark this tool as returned.');
    } finally {
      this.savingToolId.set(null);
    }
  }

  async addTool(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    const dialogRef = this.dialog.open(ToolFormDialogComponent, {
      data: { mode: 'add' },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });
    const component = dialogRef.componentInstance;
    if (!component) {
      return;
    }

    let submitSubscription: Subscription | null = null;
    submitSubscription = component.submitRequested.subscribe(async (result) => {
      if (component.saving()) {
        return;
      }

      component.setSaving(true);
      this.loading.set(true);

      try {
        const uploadedImageUrl = await this.imageUpload.uploadImage(result.imageFile);
        await this.toolbox.addTool(
          {
            ...result,
            imageUrl: uploadedImageUrl || result.imageUrl,
          },
          user,
        );
        await this.refresh();
        dialogRef.close(true);
        this.notify('Tool added.');
      } catch (error) {
        component.setSaving(false);
        this.notify(error instanceof Error ? error.message : 'Unable to add a new tool.');
      } finally {
        this.loading.set(false);
      }
    });

    dialogRef.afterClosed().subscribe(() => submitSubscription?.unsubscribe());
  }

  async editTool(tool: ToolWithStatus): Promise<void> {
    if (!tool.available) {
      return;
    }

    const dialogRef = this.dialog.open(ToolFormDialogComponent, {
      data: {
        mode: 'edit',
        value: {
          name: tool.name,
          description: tool.description,
          notes: tool.notes,
          imageUrl: tool.image,
          imageFile: null,
        },
      },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });
    const component = dialogRef.componentInstance;
    if (!component) {
      return;
    }

    let submitSubscription: Subscription | null = null;
    submitSubscription = component.submitRequested.subscribe(async (result) => {
      if (component.saving()) {
        return;
      }

      component.setSaving(true);
      this.savingToolId.set(tool.id);

      try {
        const uploadedImageUrl = await this.imageUpload.uploadImage(result.imageFile);
        await this.toolbox.updateTool(tool, {
          ...result,
          imageUrl: uploadedImageUrl || result.imageUrl,
        });
        await this.refresh();
        dialogRef.close(true);
        this.notify(`${tool.name} updated.`);
      } catch (error) {
        component.setSaving(false);
        this.notify(error instanceof Error ? error.message : 'Unable to update this tool.');
      } finally {
        this.savingToolId.set(null);
      }
    });

    dialogRef.afterClosed().subscribe(() => submitSubscription?.unsubscribe());
  }

  async deleteTool(tool: ToolWithStatus): Promise<void> {
    if (!tool.available) {
      return;
    }

    const dialogRef = this.dialog.open(DeleteToolDialogComponent, {
      data: {
        toolId: tool.id,
        toolName: tool.name,
      },
      maxWidth: '480px',
      width: 'min(92vw, 480px)',
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) {
      return;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.toolbox.markToolDeleted(tool);
      await this.refresh();
      this.notify(`${tool.name} deleted.`);
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to delete this tool.');
    } finally {
      this.savingToolId.set(null);
    }
  }

  async requestTool(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    const dialogRef = this.dialog.open(RequestToolDialogComponent, {
      maxWidth: '560px',
      width: 'min(92vw, 560px)',
    });
    const component = dialogRef.componentInstance;
    if (!component) {
      return;
    }

    let submitSubscription: Subscription | null = null;
    submitSubscription = component.submitRequested.subscribe(async (result) => {
      if (component.saving()) {
        return;
      }

      component.setSaving(true);
      this.loading.set(true);

      try {
        await this.toolbox.addToolRequest(result, user);
        dialogRef.close(true);
        this.notify('Tool request sent.');
      } catch (error) {
        component.setSaving(false);
        this.notify(error instanceof Error ? error.message : 'Unable to send tool request.');
      } finally {
        this.loading.set(false);
      }
    });

    dialogRef.afterClosed().subscribe(() => submitSubscription?.unsubscribe());
  }

  async requestNotificationPermission(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    if (!('Notification' in window)) {
      this.notify('This browser does not support push notifications.');
      return;
    }

    if (!APP_SETTINGS.firebaseVapidKey.trim()) {
      this.notify('Notifications are not configured yet. Add the Firebase Web Push VAPID key first.');
      return;
    }

    if (Notification.permission === 'denied') {
      this.notify('Notifications are blocked in the browser. Enable them in site settings first.');
      return;
    }

    try {
      await this.messaging.syncCurrentUser(user, { requestPermission: true });

      if (Notification.permission === 'granted') {
        this.notify('Notifications enabled.');
      } else if (Notification.permission === 'default') {
        this.notify('The browser did not show or confirm the notification prompt.');
      } else {
        this.notify('Notification permission was not granted.');
      }
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to update notification permissions.');
    }
  }

  private notify(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 4000 });
  }
}
