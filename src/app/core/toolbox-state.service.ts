import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { Unsubscribe } from 'firebase/firestore';

import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { FirestoreToolboxService, FIXED_TOOL_CATEGORIES } from './firestore-toolbox.service';
import { ImageUploadService } from './image-upload.service';
import { APP_SETTINGS } from './app-settings';
import { matchesUserId } from './identity.util';
import { SheetsSnapshot, ToolWithStatus } from './models';
import { decorateTools } from './tool-status.util';
import { DeleteToolDialogComponent } from '../delete-tool-dialog';
import { NotificationOptInDialogComponent } from '../notification-opt-in-dialog';
import { RequestToolDialogComponent } from '../request-tool-dialog';
import { ReturnToolDialogComponent } from '../return-tool-dialog';
import { ToolSheetAction, ToolSheetComponent, ToolSheetMode } from '../tool-sheet';
import { ToolFormDialogComponent } from '../tool-form-dialog';

type ToolSortMode = 'name' | 'date-added';

@Injectable({ providedIn: 'root' })
export class ToolboxStateService {
  private readonly listPageSize = 18;
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly toolbox = inject(FirestoreToolboxService);
  private readonly messaging = inject(FirebaseMessagingService);
  private readonly imageUpload = inject(ImageUploadService);
  private readonly router = inject(Router);

  readonly auth = inject(FirebaseAuthService);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly selectedCategoryId = signal('');
  readonly showUnavailableTools = signal(false);
  readonly toolSortMode = signal<ToolSortMode>('date-added');
  readonly savingToolId = signal<string | null>(null);
  readonly shedVisibleCount = signal(this.listPageSize);
  readonly borrowedVisibleCount = signal(this.listPageSize);
  readonly ownedVisibleCount = signal(this.listPageSize);
  private readonly snapshot = signal<SheetsSnapshot>({ categories: [], tools: [], loans: [], notifications: [] });
  private readonly loadedUserEmail = signal<string | null>(null);
  private notificationsSubscription: Unsubscribe | null = null;

  readonly tools = computed(() => decorateTools(this.snapshot()));
  readonly categories = computed(() => this.snapshot().categories.length ? this.snapshot().categories : FIXED_TOOL_CATEGORIES);
  readonly visibleTools = computed(() => this.tools().filter((tool) => !tool.deleted));
  readonly searchAutocompleteOptions = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const selectedCategoryId = this.selectedCategoryId();
    const showUnavailableTools = this.showUnavailableTools();
    const names = this.visibleTools()
      .filter((tool) => showUnavailableTools || tool.available)
      .filter((tool) => !selectedCategoryId || tool.categoryId === selectedCategoryId)
      .map((tool) => tool.name.trim())
      .filter((name) => name && (!query || name.toLowerCase().includes(query)));

    return [...new Set(names)]
      .sort((firstName, secondName) => firstName.localeCompare(secondName, undefined, { sensitivity: 'base' }))
      .slice(0, 8);
  });
  readonly filteredTools = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const selectedCategoryId = this.selectedCategoryId();
    const showUnavailableTools = this.showUnavailableTools();
    const filteredTools = this.visibleTools().filter((tool) => {
      if (!showUnavailableTools && !tool.available) {
        return false;
      }

      if (selectedCategoryId && tool.categoryId !== selectedCategoryId) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [tool.name, tool.categoryName, tool.description, tool.notes, tool.owner].some((value) =>
        value.toLowerCase().includes(query),
      );
    });

    return filteredTools.sort((firstTool, secondTool) => {
      if (this.toolSortMode() === 'date-added') {
        return this.compareToolIds(secondTool.id, firstTool.id);
      }

      return firstTool.name.localeCompare(secondTool.name, undefined, { sensitivity: 'base' });
    });
  });
  readonly borrowedTools = computed(() =>
    this.visibleTools().filter(
      (tool) => tool.activeLoan && matchesUserId(this.auth.currentUser(), tool.activeLoan.borrowerId),
    ),
  );
  readonly ownedTools = computed(() => this.visibleTools().filter((tool) => matchesUserId(this.auth.currentUser(), tool.ownerId)));
  readonly pagedFilteredTools = computed(() => this.filteredTools().slice(0, this.shedVisibleCount()));
  readonly pagedBorrowedTools = computed(() => this.borrowedTools().slice(0, this.borrowedVisibleCount()));
  readonly pagedOwnedTools = computed(() => this.ownedTools().slice(0, this.ownedVisibleCount()));
  readonly hasMoreFilteredTools = computed(() => this.pagedFilteredTools().length < this.filteredTools().length);
  readonly hasMoreBorrowedTools = computed(() => this.pagedBorrowedTools().length < this.borrowedTools().length);
  readonly hasMoreOwnedTools = computed(() => this.pagedOwnedTools().length < this.ownedTools().length);
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
          this.snapshot.set({ categories: [], tools: [], loans: [], notifications: [] });
          this.loadedUserEmail.set(null);
        }
        this.stopNotificationsLiveRefresh();
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
    const user = await this.auth.signIn();
    if (user) {
      await this.router.navigate(['/loading']);
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
    this.snapshot.set({ categories: [], tools: [], loans: [], notifications: [] });
    this.searchTerm.set('');
    this.selectedCategoryId.set('');
    this.showUnavailableTools.set(false);
    this.toolSortMode.set('date-added');
    this.loadedUserEmail.set(null);
    this.stopNotificationsLiveRefresh();
    await this.router.navigate(['/']);
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(value);
    this.resetShedPaging();
  }

  setSelectedCategory(categoryId: string): void {
    this.selectedCategoryId.set(categoryId);
    this.resetShedPaging();
  }

  toggleUnavailableTools(): void {
    this.showUnavailableTools.update((value) => !value);
    this.resetShedPaging();
  }

  setToolSortMode(sortMode: ToolSortMode): void {
    this.toolSortMode.set(sortMode);
    this.resetShedPaging();
  }

  showMoreFilteredTools(): void {
    this.shedVisibleCount.update((count) => count + this.listPageSize);
  }

  showMoreBorrowedTools(): void {
    this.borrowedVisibleCount.update((count) => count + this.listPageSize);
  }

  showMoreOwnedTools(): void {
    this.ownedVisibleCount.update((count) => count + this.listPageSize);
  }

  async refresh(): Promise<void> {
    if (!(await this.auth.ensureValidSession())) {
      return;
    }

    this.loading.set(true);
    try {
      const snapshot = await this.toolbox.loadSnapshot();
      this.snapshot.set(snapshot);
      this.resetListPaging();
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to refresh toolbox data.');
    } finally {
      this.loading.set(false);
    }
  }

  startNotificationsLiveRefresh(): void {
    if (this.notificationsSubscription || !this.auth.currentUser()) {
      return;
    }

    this.notificationsSubscription = this.toolbox.watchNotifications(
      (notifications) => {
        this.snapshot.update((snapshot) => ({ ...snapshot, notifications }));
      },
      (error) => {
        this.notify(error.message || 'Unable to refresh notifications.');
      },
    );
  }

  stopNotificationsLiveRefresh(): void {
    this.notificationsSubscription?.();
    this.notificationsSubscription = null;
  }

  async openTool(tool: ToolWithStatus, mode: ToolSheetMode = 'shed'): Promise<void> {
    const actionRequested = new Subject<ToolSheetAction>();
    const sheetRef = this.bottomSheet.open<ToolSheetComponent, unknown, void>(
      ToolSheetComponent,
      {
      data: {
        actionRequested,
        mode,
        saving: this.savingToolId() === tool.id,
        tool,
        canBorrow: !matchesUserId(this.auth.currentUser(), tool.ownerId),
      },
      panelClass: 'rounded-bottom-sheet-panel',
    },
    );

    let handlingAction = false;
    const actionSubscription = actionRequested.subscribe(async (action) => {
      if (handlingAction) {
        return;
      }

      handlingAction = true;
      const completed = await this.handleToolSheetAction(action, tool);
      handlingAction = false;

      if (completed) {
        sheetRef.dismiss();
      }
    });

    sheetRef.afterDismissed().subscribe(() => {
      actionSubscription.unsubscribe();
      actionRequested.complete();
    });
  }

  private async handleToolSheetAction(action: ToolSheetAction, tool: ToolWithStatus): Promise<boolean> {
    if (action === 'borrow') {
      return this.borrowTool(tool);
    }

    if (action === 'return') {
      return this.returnTool(tool);
    }

    if (action === 'edit') {
      return this.editTool(tool);
    }

    return this.deleteTool(tool);
  }

  async borrowTool(tool: ToolWithStatus): Promise<boolean> {
    const user = this.auth.currentUser();
    if (!user || !tool.available) {
      return false;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.toolbox.addBorrowRequest(tool.documentId, user);
      await this.refresh();
      await this.router.navigate(['/borrowed']);
      this.notify(`Borrow request saved for ${this.formatToolTitle(tool.name)}.`);
      return true;
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to request this tool.');
      return false;
    } finally {
      this.savingToolId.set(null);
    }
  }

  async returnTool(tool: ToolWithStatus): Promise<boolean> {
    if (!tool.activeLoan) {
      return false;
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
      return false;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.toolbox.markReturned(tool.activeLoan);
      await this.refresh();
      this.notify(`${this.formatToolTitle(tool.name)} marked as returned.`);
      return true;
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to mark this tool as returned.');
      return false;
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
      data: { categories: this.categories(), mode: 'add' },
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

  async editTool(tool: ToolWithStatus): Promise<boolean> {
    if (!tool.available) {
      return false;
    }

    const dialogRef = this.dialog.open(ToolFormDialogComponent, {
      data: {
        categories: this.categories(),
        mode: 'edit',
        value: {
          name: tool.name,
          categoryId: tool.categoryId,
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
      return false;
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
        this.notify(`${this.formatToolTitle(tool.name)} updated.`);
      } catch (error) {
        component.setSaving(false);
        this.notify(error instanceof Error ? error.message : 'Unable to update this tool.');
      } finally {
        this.savingToolId.set(null);
      }
    });

    dialogRef.afterClosed().subscribe(() => submitSubscription?.unsubscribe());
    return Boolean(await firstValueFrom(dialogRef.afterClosed()));
  }

  async deleteTool(tool: ToolWithStatus): Promise<boolean> {
    if (!tool.available) {
      return false;
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
      return false;
    }

    this.savingToolId.set(tool.id);
    try {
      await this.toolbox.markToolDeleted(tool);
      await this.refresh();
      this.notify(`${this.formatToolTitle(tool.name)} deleted.`);
      return true;
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to delete this tool.');
      return false;
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

  private resetShedPaging(): void {
    this.shedVisibleCount.set(this.listPageSize);
  }

  private resetListPaging(): void {
    this.resetShedPaging();
    this.borrowedVisibleCount.set(this.listPageSize);
    this.ownedVisibleCount.set(this.listPageSize);
  }

  private formatToolTitle(value: string): string {
    return value.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  private compareToolIds(firstId: string, secondId: string): number {
    const firstNumber = Number(firstId);
    const secondNumber = Number(secondId);
    if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
      return firstNumber - secondNumber;
    }

    return firstId.localeCompare(secondId, undefined, { numeric: true, sensitivity: 'base' });
  }
}
