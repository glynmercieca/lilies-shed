import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { MatBottomSheet, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, Subscription, filter, firstValueFrom } from 'rxjs';
import { Unsubscribe } from 'firebase/firestore';

import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseMessagingService } from './firebase-messaging.service';
import { FirestoreToolboxService, FIXED_TOOL_CATEGORIES } from './firestore-toolbox.service';
import { ImageUploadService } from './image-upload.service';
import { APP_SETTINGS } from './app-settings';
import { CategoryDiscoveryService } from './category-discovery.service';
import { matchesUserId } from './identity.util';
import { SheetsSnapshot, ToolCategoryRecord, ToolWithStatus } from './models';
import { decorateTools } from './tool-status.util';
import { DeleteToolDialogComponent } from '../delete-tool-dialog';
import { NotificationOptInDialogComponent } from '../notification-opt-in-dialog';
import { RequestToolDialogComponent } from '../request-tool-dialog';
import { ReturnToolDialogComponent } from '../return-tool-dialog';
import { ToolImagePreviewDialogComponent } from '../tool-image-preview-dialog';
import { ToolSheetAction, ToolSheetComponent, ToolSheetMode } from '../tool-sheet';
import { ToolFormDialogComponent } from '../tool-form-dialog';

type ToolSortMode = 'name' | 'date-added';

const CATEGORY_DISCOVERY_ADMIN_USER_ID = 'R01SeK0oBJPFVBt0Okm12BnLxgs2';
const CATEGORY_DISCOVERY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const CATEGORY_DISCOVERY_STORAGE_KEY = 'lilies-shed.last-category-discovery-at';

@Injectable({ providedIn: 'root' })
export class ToolboxStateService {
  private readonly listPageSize = 18;
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly toolbox = inject(FirestoreToolboxService);
  private readonly categoryDiscovery = inject(CategoryDiscoveryService);
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
  readonly categoryDiscoveryRunning = signal(false);
  readonly shedVisibleCount = signal(this.listPageSize);
  readonly borrowedVisibleCount = signal(this.listPageSize);
  readonly ownedVisibleCount = signal(this.listPageSize);
  private readonly snapshot = signal<SheetsSnapshot>({ categories: [], tools: [], loans: [], notifications: [] });
  private readonly readNotificationIds = signal<Set<string>>(new Set());
  private readonly loadedUserEmail = signal<string | null>(null);
  private activeAddToolDialogRef: MatDialogRef<ToolFormDialogComponent> | null = null;
  private activeImagePreviewDialogRef: MatDialogRef<ToolImagePreviewDialogComponent> | null = null;
  private activeRequestToolDialogRef: MatDialogRef<RequestToolDialogComponent> | null = null;
  private activeToolSheetKey = '';
  private activeToolSheetRef: MatBottomSheetRef<ToolSheetComponent> | null = null;
  private activeToolSheetTool: ToolWithStatus | null = null;
  private syncingOverlayFromRoute = false;
  private notificationsSubscription: Unsubscribe | null = null;
  private readNotificationsSubscription: Unsubscribe | null = null;

  readonly tools = computed(() => decorateTools(this.snapshot()));
  readonly categories = computed(() =>
    [...(this.snapshot().categories.length ? this.snapshot().categories : FIXED_TOOL_CATEGORIES)].sort(
      (firstCategory, secondCategory) =>
        firstCategory.name.localeCompare(secondCategory.name, undefined, { sensitivity: 'base' }),
    ),
  );
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
  readonly canRunCategoryDiscovery = computed(() => this.auth.currentUser()?.id === CATEGORY_DISCOVERY_ADMIN_USER_ID);
  readonly recentNotifications = computed(() =>
    this.snapshot()
      .notifications.filter((notification) => !notification.recipientId || matchesUserId(this.auth.currentUser(), notification.recipientId))
      .slice(0, 10)
      .map((notification) => ({
        ...notification,
        read: this.readNotificationIds().has(notification.id),
      })),
  );
  readonly unreadNotificationCount = computed(() => {
    const readNotificationIds = this.readNotificationIds();
    return this.snapshot().notifications.filter(
      (notification) =>
        (!notification.recipientId || matchesUserId(this.auth.currentUser(), notification.recipientId)) &&
        !readNotificationIds.has(notification.id),
    ).length;
  });

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      const loadedUserEmail = this.loadedUserEmail();

      if (!user) {
        if (loadedUserEmail) {
          this.snapshot.set({ categories: [], tools: [], loans: [], notifications: [] });
          this.readNotificationIds.set(new Set());
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
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.syncOverlayFromRoute();
    });
    effect(() => {
      this.tools();
      this.syncOverlayFromRoute();
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
    this.readNotificationIds.set(new Set());
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
      const user = this.auth.currentUser();
      const [snapshot, readNotificationIds] = await Promise.all([
        this.toolbox.loadSnapshot(),
        user ? this.toolbox.loadReadNotificationIds(user.id) : Promise.resolve(new Set<string>()),
      ]);
      this.snapshot.set(snapshot);
      this.readNotificationIds.set(readNotificationIds);
      this.resetListPaging();
      void this.runWeeklyCategoryDiscovery();
    } catch (error) {
      this.notify(error instanceof Error ? error.message : 'Unable to refresh toolbox data.');
    } finally {
      this.loading.set(false);
    }
  }

  startNotificationsLiveRefresh(): void {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    if (!this.notificationsSubscription) {
      this.notificationsSubscription = this.toolbox.watchNotifications(
        (notifications) => {
          this.snapshot.update((snapshot) => ({ ...snapshot, notifications }));
        },
        (error) => {
          this.notify(error.message || 'Unable to refresh notifications.');
        },
      );
    }

    if (!this.readNotificationsSubscription) {
      this.readNotificationsSubscription = this.toolbox.watchReadNotificationIds(
        user.id,
        (readNotificationIds) => {
          this.readNotificationIds.set(readNotificationIds);
        },
        (error) => {
          this.notify(error.message || 'Unable to refresh read notifications.');
        },
      );
    }
  }

  stopNotificationsLiveRefresh(): void {
    this.notificationsSubscription?.();
    this.notificationsSubscription = null;
    this.readNotificationsSubscription?.();
    this.readNotificationsSubscription = null;
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || this.readNotificationIds().has(notificationId)) {
      return;
    }

    this.readNotificationIds.update((readNotificationIds) => new Set([...readNotificationIds, notificationId]));
    try {
      await this.toolbox.markNotificationRead(user.id, notificationId);
    } catch (error) {
      this.readNotificationIds.update((readNotificationIds) => {
        const nextReadNotificationIds = new Set(readNotificationIds);
        nextReadNotificationIds.delete(notificationId);
        return nextReadNotificationIds;
      });
      this.notify(error instanceof Error ? error.message : 'Unable to mark this notification as read.');
    }
  }

  async markUnreadNotificationsRead(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    const readNotificationIds = this.readNotificationIds();
    const unreadNotificationIds = this.snapshot()
      .notifications.filter(
        (notification) =>
          (!notification.recipientId || matchesUserId(user, notification.recipientId)) &&
          !readNotificationIds.has(notification.id),
      )
      .map((notification) => notification.id);

    if (!unreadNotificationIds.length) {
      return;
    }

    this.readNotificationIds.update(
      (currentReadNotificationIds) => new Set([...currentReadNotificationIds, ...unreadNotificationIds]),
    );
    try {
      await this.toolbox.markNotificationsRead(user.id, unreadNotificationIds);
    } catch (error) {
      this.readNotificationIds.update((currentReadNotificationIds) => {
        const nextReadNotificationIds = new Set(currentReadNotificationIds);
        unreadNotificationIds.forEach((notificationId) => nextReadNotificationIds.delete(notificationId));
        return nextReadNotificationIds;
      });
      this.notify(error instanceof Error ? error.message : 'Unable to mark notifications as read.');
    }
  }

  async runCategoryDiscovery(): Promise<void> {
    await this.discoverAndSaveCategories({ manual: true });
  }

  async openTool(tool: ToolWithStatus, mode: ToolSheetMode = 'shed'): Promise<void> {
    await this.router.navigate([], {
      queryParams: {
        dialog: null,
        mode,
        preview: null,
        sheet: 'tool',
        toolId: tool.documentId,
      },
      queryParamsHandling: 'merge',
    });
  }

  private openToolSheet(tool: ToolWithStatus, mode: ToolSheetMode = 'shed'): void {
    const actionRequested = new Subject<ToolSheetAction>();
    const previewRequested = new Subject<void>();
    const sheetRef = this.bottomSheet.open<ToolSheetComponent, unknown, void>(
      ToolSheetComponent,
      {
        closeOnNavigation: false,
        data: {
          actionRequested,
          mode,
          previewRequested,
          saving: this.savingToolId() === tool.id,
          tool,
          canBorrow: !matchesUserId(this.auth.currentUser(), tool.ownerId),
        },
        panelClass: 'rounded-bottom-sheet-panel',
      },
    );
    this.activeToolSheetKey = this.toolSheetKey(tool.documentId, mode);
    this.activeToolSheetRef = sheetRef;
    this.activeToolSheetTool = tool;

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
    const previewSubscription = previewRequested.subscribe(() => {
      void this.router.navigate([], {
        queryParams: { preview: 'tool-image' },
        queryParamsHandling: 'merge',
      });
    });

    sheetRef.afterDismissed().subscribe(() => {
      if (this.activeToolSheetRef === sheetRef) {
        this.activeToolSheetRef = null;
        this.activeToolSheetKey = '';
        this.activeToolSheetTool = null;
      }
      this.activeImagePreviewDialogRef?.close();
      actionSubscription.unsubscribe();
      previewSubscription.unsubscribe();
      actionRequested.complete();
      previewRequested.complete();
      if (!this.syncingOverlayFromRoute && this.currentQueryParam('sheet') === 'tool') {
        void this.clearOverlayQueryParams();
      }
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
    await this.router.navigate([], {
      queryParams: {
        dialog: 'add-tool',
        mode: null,
        preview: null,
        sheet: null,
        toolId: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  private openAddToolDialog(): void {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    const dialogRef = this.dialog.open(ToolFormDialogComponent, {
      closeOnNavigation: false,
      data: { categories: this.categories(), mode: 'add' },
      maxWidth: '640px',
      width: 'min(92vw, 640px)',
    });
    this.activeAddToolDialogRef = dialogRef;
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

    dialogRef.afterClosed().subscribe(() => {
      if (this.activeAddToolDialogRef === dialogRef) {
        this.activeAddToolDialogRef = null;
      }
      submitSubscription?.unsubscribe();
      if (!this.syncingOverlayFromRoute && this.currentQueryParam('dialog') === 'add-tool') {
        void this.clearOverlayQueryParams();
      }
    });
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
    await this.router.navigate([], {
      queryParams: {
        dialog: 'request-tool',
        mode: null,
        preview: null,
        sheet: null,
        toolId: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  private openRequestToolDialog(): void {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    const dialogRef = this.dialog.open(RequestToolDialogComponent, {
      closeOnNavigation: false,
      maxWidth: '560px',
      width: 'min(92vw, 560px)',
    });
    this.activeRequestToolDialogRef = dialogRef;
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

    dialogRef.afterClosed().subscribe(() => {
      if (this.activeRequestToolDialogRef === dialogRef) {
        this.activeRequestToolDialogRef = null;
      }
      submitSubscription?.unsubscribe();
      if (!this.syncingOverlayFromRoute && this.currentQueryParam('dialog') === 'request-tool') {
        void this.clearOverlayQueryParams();
      }
    });
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

  private async runWeeklyCategoryDiscovery(): Promise<void> {
    const lastRunAt = Number(window.localStorage.getItem(CATEGORY_DISCOVERY_STORAGE_KEY) ?? 0);
    if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < CATEGORY_DISCOVERY_INTERVAL_MS) {
      return;
    }

    await this.discoverAndSaveCategories({ manual: false });
  }

  private async discoverAndSaveCategories(options: { manual: boolean }): Promise<void> {
    if (this.categoryDiscoveryRunning()) {
      return;
    }

    this.categoryDiscoveryRunning.set(true);
    if (options.manual) {
      this.notify('Scanning tools for new categories...');
    }

    try {
      const snapshot = this.snapshot();
      const discoveredCategories = this.categoryDiscovery.discoverCategories(snapshot.tools, snapshot.categories);
      if (!discoveredCategories.length) {
        if (options.manual) {
          this.notify('No new categories found.');
        }
        window.localStorage.setItem(CATEGORY_DISCOVERY_STORAGE_KEY, String(Date.now()));
        return;
      }

      await this.toolbox.saveDiscoveredCategories(discoveredCategories);
      this.snapshot.update((currentSnapshot) => ({
        ...currentSnapshot,
        categories: this.mergeCategories(currentSnapshot.categories, discoveredCategories),
      }));
      window.localStorage.setItem(CATEGORY_DISCOVERY_STORAGE_KEY, String(Date.now()));
      if (options.manual) {
        this.notify(`Added ${discoveredCategories.length} ${discoveredCategories.length === 1 ? 'category' : 'categories'}.`);
      }
    } catch (error) {
      if (options.manual) {
        const message = error instanceof Error ? error.message : '';
        this.notify(
          message.toLowerCase().includes('permission')
            ? 'Category discovery needs updated Firestore rules deployed.'
            : message || 'Unable to discover new categories.',
        );
      }
    } finally {
      this.categoryDiscoveryRunning.set(false);
    }
  }

  private mergeCategories(
    currentCategories: ToolCategoryRecord[],
    discoveredCategories: ToolCategoryRecord[],
  ): ToolCategoryRecord[] {
    const categoriesById = new Map(currentCategories.map((category) => [category.id, category]));
    discoveredCategories.forEach((category) => categoriesById.set(category.id, category));
    return [...categoriesById.values()].sort((firstCategory, secondCategory) => firstCategory.order - secondCategory.order);
  }

  private resetShedPaging(): void {
    this.shedVisibleCount.set(this.listPageSize);
  }

  private resetListPaging(): void {
    this.resetShedPaging();
    this.borrowedVisibleCount.set(this.listPageSize);
    this.ownedVisibleCount.set(this.listPageSize);
  }

  private syncOverlayFromRoute(): void {
    const queryParamMap = this.router.parseUrl(this.router.url).queryParamMap;
    const sheet = queryParamMap.get('sheet');
    const dialog = queryParamMap.get('dialog');
    const preview = queryParamMap.get('preview');

    this.syncingOverlayFromRoute = true;
    try {
      if (sheet === 'tool') {
        const mode = this.parseToolSheetMode(queryParamMap.get('mode'));
        const toolId = queryParamMap.get('toolId') ?? '';
        const key = this.toolSheetKey(toolId, mode);
        const tool = this.visibleTools().find((candidate) => candidate.documentId === toolId || candidate.id === toolId);

        if (tool && this.activeToolSheetKey !== key) {
          this.activeToolSheetRef?.dismiss();
          this.openToolSheet(tool, mode);
        }
      } else if (this.activeToolSheetRef) {
        this.activeToolSheetRef.dismiss();
      }

      if (preview === 'tool-image') {
        this.openImagePreviewDialog();
      } else if (this.activeImagePreviewDialogRef) {
        this.activeImagePreviewDialogRef.close();
      }

      if (dialog === 'add-tool') {
        this.activeRequestToolDialogRef?.close();
        if (!this.activeAddToolDialogRef) {
          this.openAddToolDialog();
        }
      } else if (dialog === 'request-tool') {
        this.activeAddToolDialogRef?.close();
        if (!this.activeRequestToolDialogRef) {
          this.openRequestToolDialog();
        }
      } else {
        this.activeAddToolDialogRef?.close();
        this.activeRequestToolDialogRef?.close();
      }
    } finally {
      this.syncingOverlayFromRoute = false;
    }
  }

  private async clearOverlayQueryParams(): Promise<void> {
    await this.router.navigate([], {
      queryParams: {
        dialog: null,
        mode: null,
        preview: null,
        sheet: null,
        toolId: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private async clearPreviewQueryParam(): Promise<void> {
    await this.router.navigate([], {
      queryParams: { preview: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private openImagePreviewDialog(): void {
    const tool = this.activeToolSheetTool;
    if (!tool || this.activeImagePreviewDialogRef) {
      return;
    }

    const dialogRef = this.dialog.open(ToolImagePreviewDialogComponent, {
      autoFocus: false,
      closeOnNavigation: false,
      data: {
        alt: tool.name,
        image: tool.image,
      },
      height: '100dvh',
      maxHeight: '100dvh',
      maxWidth: '100vw',
      panelClass: 'tool-image-preview-dialog-panel',
      width: '100vw',
    });
    this.activeImagePreviewDialogRef = dialogRef;

    dialogRef.afterClosed().subscribe(() => {
      if (this.activeImagePreviewDialogRef === dialogRef) {
        this.activeImagePreviewDialogRef = null;
      }
      if (!this.syncingOverlayFromRoute && this.currentQueryParam('preview') === 'tool-image') {
        void this.clearPreviewQueryParam();
      }
    });
  }

  private currentQueryParam(name: string): string | null {
    return this.router.parseUrl(this.router.url).queryParamMap.get(name);
  }

  private formatToolTitle(value: string): string {
    return value.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  private parseToolSheetMode(value: string | null): ToolSheetMode {
    if (value === 'borrowed' || value === 'my-tools') {
      return value;
    }

    return 'shed';
  }

  private toolSheetKey(toolId: string, mode: ToolSheetMode): string {
    return `${mode}:${toolId}`;
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
