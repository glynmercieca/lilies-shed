import fixedCategories from './tool-categories.json';
import { Injectable, inject } from '@angular/core';
import {
  QueryDocumentSnapshot,
  Query,
  DocumentData,
  Timestamp,
  collection,
  doc,
  documentId,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  where,
} from 'firebase/firestore';

import { FirebaseClientService } from './firebase-client.service';
import { formatOwnerDisplay, splitUserName } from './identity.util';
import {
  AppNotificationRecord,
  LoanRecord,
  SheetsSnapshot,
  ToolCategoryRecord,
  ToolFormValue,
  ToolRecord,
  UserProfile,
} from './models';
import { boundReadNotificationIds, mergeNotifications, NOTIFICATION_QUERY_LIMIT } from './notification.util';
import { reserveTool, returnLoan } from './borrow-operations';
import { ToolRequestFormValue } from '../request-tool-dialog';

interface FirestoreUserRecord {
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string;
}

export const FIXED_TOOL_CATEGORIES: ToolCategoryRecord[] = fixedCategories;

@Injectable({ providedIn: 'root' })
export class FirestoreToolboxService {
  private readonly firebase = inject(FirebaseClientService);

  private usersCache = new Map<string, { expires: number; value: Promise<UserProfile | null> }>();
  private categoriesCache: { expires: number; value: Promise<ToolCategoryRecord[]> } | null = null;
  private inventorySourceCache: { expires: number; value: Promise<Query<DocumentData>> } | null = null;

  private inventorySource(): Promise<Query<DocumentData>> {
    if (!this.inventorySourceCache || this.inventorySourceCache.expires < Date.now()) {
      const value = getDocFromServer(doc(this.firebase.firestore, 'appConfig', 'inventory')).then(marker => {
        const tools = collection(this.firebase.firestore, 'tools');
        // Missing fields are excluded by Firestore equality queries. Enable this
        // only after the trusted migration has verified every legacy tool.
        return marker.data()?.['schemaVersion'] === 1 ? query(tools, where('deleted', '==', false)) : query(tools);
      }).catch(error => {
        this.inventorySourceCache = null;
        if (this.isPermissionDenied(error)) return query(collection(this.firebase.firestore, 'tools'));
        throw error;
      });
      this.inventorySourceCache = { expires: Date.now() + 300_000, value };
    }
    return this.inventorySourceCache.value;
  }

  async loadSnapshot(userId: string): Promise<SheetsSnapshot> {
    const source = await this.inventorySource();
    const [categories, toolsSnapshot, notifications] = await Promise.all([
      this.cachedCategories(),
      getDocsFromServer(source),
      this.loadNotifications(userId),
    ]);
    const { tools, loans } = await this.parseToolDocuments(toolsSnapshot.docs);
    return { categories, tools, loans, notifications };
  }

  async loadToolUpdate(toolId: string): Promise<{ tools: ToolRecord[]; loans: LoanRecord[] }> {
    const snapshot = await getDocFromServer(doc(this.firebase.firestore, 'tools', toolId));
    return this.parseToolDocuments(snapshot.exists() ? [snapshot] : []);
  }

  watchToolChanges(
    knownTools: ToolRecord[],
    onChange: (toolIds: string[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    const versions = new Map(knownTools.map(tool => [tool.documentId, tool.updatedAt ?? '']));
    let stopped = false;
    let unsubscribe: Unsubscribe | undefined;
    void this.inventorySource().then(source => {
      if (stopped) return;
      unsubscribe = onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
      // Local pending writes and cached results do not verify shared availability.
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const current = new Map(snapshot.docs.map(document => [document.id, this.readDateTimeString(document.data()['updatedAt'])]));
      const changed = [...current].filter(([id, version]) => !versions.has(id) || versions.get(id) !== version).map(([id]) => id);
      for (const id of versions.keys()) if (!current.has(id)) changed.push(id);
      versions.clear();
      current.forEach((version, id) => versions.set(id, version));
      if (changed.length) onChange(changed);
      }, onError);
    }).catch(error => { if (!stopped) onError(error); });
    return () => { stopped = true; unsubscribe?.(); };
  }

  private async parseToolDocuments(documents: Array<{ id: string; data(): DocumentData | undefined }>) {
    const records = documents.map((snapshot) => ({ id: snapshot.id, data: snapshot.data()! }));
    const ids = [...new Set(records.flatMap(({ data }) => [data['activeLoanId'], data['latestLoanId']]).filter(Boolean))];
    const legacyAliases = [...new Set(records.filter(({ data }) => !('latestLoanId' in data))
      .flatMap(({ id, data }) => [id, this.readString(data['id']) || id]))];
    const queries = Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) =>
      query(collection(this.firebase.firestore, 'loan'), where(documentId(), 'in', ids.slice(index * 30, index * 30 + 30))));
    for (let index = 0; index < legacyAliases.length; index += 30) {
      for (const field of ['toolId', 'itemId']) queries.push(query(collection(this.firebase.firestore, 'loan'), where(field, 'in', legacyAliases.slice(index, index + 30))));
    }
    const groups = await Promise.all(queries.map(source => getDocsFromServer(source)));
    const loanDocuments = [...new Map(groups.flatMap(group => group.docs).map(snapshot => [snapshot.id, snapshot])).values()];
    const userIds = [...new Set([
      ...records.map(({ data }) => this.readString(data['ownerId'])),
      ...loanDocuments.map((snapshot) => this.readString(snapshot.data()['borrowerId'])),
    ].filter(Boolean))];
    const users = await Promise.all(userIds.map((id) => this.cachedUser(id)));
    const usersById = new Map(users.filter((user): user is UserProfile => Boolean(user)).map((user) => [user.id, user]));
    const aliases = new Map(records.flatMap(({ id, data }) => [[id, id], [this.readString(data['id']) || id, id]] as [string, string][]));
    const tools = records.map(({ id, data }) => this.parseTool(id, data, usersById)).filter((tool): tool is ToolRecord => Boolean(tool));
    const loans = loanDocuments.map((snapshot) => this.parseLoan(snapshot.id, snapshot.data(), usersById))
      .filter((loan): loan is LoanRecord => Boolean(loan))
      .map((loan) => ({ ...loan, itemId: aliases.get(loan.itemId) ?? loan.itemId }));
    return { tools, loans };
  }

  private cachedCategories(): Promise<ToolCategoryRecord[]> {
    if (!this.categoriesCache || this.categoriesCache.expires < Date.now()) {
      this.categoriesCache = { expires: Date.now() + 300_000, value: this.loadCategories() };
    }
    return this.categoriesCache.value;
  }

  private cachedUser(id: string): Promise<UserProfile | null> {
    const cached = this.usersCache.get(id);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = getDoc(doc(this.firebase.firestore, 'publicProfiles', id)).then((snapshot) => {
      if (!snapshot.exists()) return null;
      const data = snapshot.data() as FirestoreUserRecord;
      const email = this.readString(data.email).toLowerCase();
      const name = this.readString(data.displayName) || email || id;
      const parts = splitUserName(name);
      return { id, email, name, picture: this.readString(data.photoURL),
        firstName: this.readString(data.firstName) || parts.firstName,
        lastName: this.readString(data.lastName) || parts.lastName };
    }).catch((error) => {
      this.usersCache.delete(id);
      // Display profiles are optional during rollout. Never fall back to reading
      // another member's private users record, and retry on the next refresh.
      if (this.isPermissionDenied(error)) return null;
      throw error;
    });
    this.usersCache.set(id, { expires: Date.now() + 300_000, value });
    return value;
  }

  async loadNotifications(userId: string): Promise<AppNotificationRecord[]> {
    const fallbackSources = this.notificationsQueries(userId, false);
    const groups = await Promise.all(this.notificationsQueries(userId).map(async (source, index) => {
      try {
        const snapshot = await getDocs(source);
        return this.parseNotificationsSnapshot(snapshot.docs);
      } catch (error) {
        if (!this.isMissingNotificationIndex(error)) throw error;
        const snapshot = await getDocs(fallbackSources[index]);
        return this.boundNotificationsSnapshot(snapshot.docs);
      }
    }));
    return mergeNotifications(groups);
  }

  async loadReadNotificationIds(userId: string): Promise<Set<string>> {
    const userSnapshot = await getDoc(doc(this.firebase.firestore, 'users', userId));
    return new Set(this.readStringArray(userSnapshot.data()?.['readNotificationIds']));
  }

  watchNotifications(
    userId: string,
    onChange: (notifications: AppNotificationRecord[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    const sources = this.notificationsQueries(userId);
    const fallbackSources = this.notificationsQueries(userId, false);
    const groups: AppNotificationRecord[][] = sources.map(() => []);
    const ready = new Set<number>();
    let active = true;
    const subscriptions: Unsubscribe[] = [];
    const subscribe = (source: typeof sources[number], index: number, fallback = false): void => {
      subscriptions.push(onSnapshot(
        source,
        (snapshot) => {
          if (!active) return;
          groups[index] = fallback
            ? this.boundNotificationsSnapshot(snapshot.docs)
            : this.parseNotificationsSnapshot(snapshot.docs);
          ready.add(index);
          if (ready.size === sources.length) onChange(mergeNotifications(groups));
        },
        (error) => {
          if (!active) return;
          // Firestore closes a failed listener. Retry once without the composite index.
          if (!fallback && this.isMissingNotificationIndex(error)) {
            subscribe(fallbackSources[index], index, true);
          } else {
            onError?.(error);
          }
        },
      ));
    };
    sources.forEach((source, index) => subscribe(source, index));
    return () => {
      active = false;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }

  watchReadNotificationIds(
    userId: string,
    onChange: (readNotificationIds: Set<string>) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      doc(this.firebase.firestore, 'users', userId),
      (snapshot) => onChange(new Set(this.readStringArray(snapshot.data()?.['readNotificationIds']))),
      (error) => onError?.(error),
    );
  }

  async markNotificationRead(userId: string, notificationId: string, visibleIds: string[] = []): Promise<void> {
    await this.markNotificationsRead(userId, [notificationId], visibleIds);
  }

  async markNotificationsRead(userId: string, notificationIds: string[], visibleIds: string[] = []): Promise<void> {
    if (!notificationIds.length) return;
    const userRef = doc(this.firebase.firestore, 'users', userId);
    // A transaction preserves marks made concurrently by other tabs/devices.
    await runTransaction(this.firebase.firestore, async (transaction) => {
      const snapshot = await transaction.get(userRef);
      transaction.set(userRef, {
        readNotificationIds: boundReadNotificationIds(
          this.readStringArray(snapshot.data()?.['readNotificationIds']), notificationIds, visibleIds,
        ),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
  }

  async addBorrowRequest(toolId: string, borrower: UserProfile): Promise<void> {
    await reserveTool(this.firebase.firestore, toolId, borrower.id, this.today());
  }

  async markReturned(loan: LoanRecord): Promise<void> {
    await returnLoan(this.firebase.firestore, loan.id, this.today());
  }

  async addTool(formValue: ToolFormValue, owner: UserProfile): Promise<string> {
    const toolRef = doc(collection(this.firebase.firestore, 'tools'));
    const category = await this.resolveSavedCategory(formValue.categoryId);
    await setDoc(toolRef, {
      id: toolRef.id,
      name: formValue.name,
      categoryId: category.id,
      categoryName: category.name,
      description: formValue.description,
      notes: formValue.notes,
      deleted: false,
      borrowStateVersion: 1,
      activeLoanId: null,
      latestLoanId: null,
      ownerId: owner.id,
      image: formValue.imageUrl,
      thumbnail: formValue.thumbnailUrl || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return toolRef.id;
  }

  async updateTool(tool: ToolRecord, formValue: ToolFormValue): Promise<void> {
    const category = await this.resolveSavedCategory(formValue.categoryId);
    await this.updateAvailableTool(tool, {
      name: formValue.name,
      categoryId: category.id,
      categoryName: category.name,
      description: formValue.description,
      notes: formValue.notes,
      image: formValue.imageUrl,
      thumbnail: formValue.thumbnailUrl || '',
      updatedAt: serverTimestamp(),
    });
  }

  async markToolDeleted(tool: ToolRecord): Promise<void> {
    await this.updateAvailableTool(tool, {
      deleted: true,
      updatedAt: serverTimestamp(),
    });
  }

  private async updateAvailableTool(tool: ToolRecord, changes: DocumentData): Promise<void> {
    const reference = doc(this.firebase.firestore, 'tools', tool.documentId);
    await runTransaction(this.firebase.firestore, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists() || this.readBoolean(snapshot.data()?.['deleted'])) throw new Error('This tool no longer exists.');
      if (snapshot.data()?.['borrowStateVersion'] !== 1 || snapshot.data()?.['activeLoanId'] !== null) {
        throw new Error('Only an available tool with reconciled loan history can be changed.');
      }
      transaction.update(reference, changes);
    });
  }

  async addToolRequest(request: ToolRequestFormValue, requester: UserProfile): Promise<void> {
    const requestRef = doc(collection(this.firebase.firestore, 'requests'));
    await setDoc(requestRef, {
      message: request.message,
      requesterId: requester.id,
      createdAt: serverTimestamp(),
    });
  }

  async saveDiscoveredCategories(categories: ToolCategoryRecord[]): Promise<void> {
    if (!categories.length) {
      return;
    }

    this.categoriesCache = null;
    await Promise.all(
      categories.map((category) =>
        setDoc(
          doc(this.firebase.firestore, 'categories', category.id),
          {
            id: category.id,
            name: category.name,
            order: category.order,
            discoveredAt: serverTimestamp(),
          },
          { merge: false },
        ),
      ),
    );
  }

  private parseTool(id: string, data: DocumentData, usersById: Map<string, UserProfile>): ToolRecord | null {
    const ownerId = this.readString(data['ownerId']);
    const user = usersById.get(ownerId) ?? null;
    const ownerFirstName = user?.firstName ?? '';
    const ownerLastName = user?.lastName ?? '';
    const ownerEmail = user?.email ?? '';
    const ownerDisplay =
      formatOwnerDisplay(ownerFirstName, ownerLastName, ownerEmail) || this.readString(data['owner']);

    const toolId = this.readString(data['id']) || id;
    const name = this.readString(data['name']);
    if (!toolId || !name) {
      return null;
    }

    return {
      documentId: id,
      id: toolId,
      name,
      categoryId: this.readString(data['categoryId']) || 'other',
      categoryName: this.readString(data['categoryName']) || this.resolveCategory(data['categoryId']).name,
      description: this.readString(data['description']),
      notes: this.readString(data['notes']),
      deleted: this.readBoolean(data['deleted']),
      ownerId,
      activeLoanId: data['activeLoanId'],
      owner: ownerDisplay,
      ownerEmail,
      ownerFirstName,
      ownerLastName,
      image: this.readString(data['image']),
      thumbnail: this.readString(data['thumbnail']),
      createdAt: this.readDateTimeString(data['createdAt']),
      updatedAt: this.readDateTimeString(data['updatedAt']),
    };
  }

  private parseCategory(id: string, data: DocumentData): ToolCategoryRecord | null {
    const name = this.readString(data['name']);
    const order = Number(data['order'] ?? 0);
    if (!id || !name || !Number.isFinite(order)) {
      return null;
    }

    return { id, name, order };
  }

  private parseLoan(id: string, data: DocumentData, usersById: Map<string, UserProfile>): LoanRecord | null {
    const borrowerId = this.readString(data['borrowerId']);
    const user = usersById.get(borrowerId) ?? null;
    const borrowerFirstName = user?.firstName ?? '';
    const borrowerLastName = user?.lastName ?? '';
    const borrowerEmail = user?.email ?? '';
    const borrowerDisplay =
      formatOwnerDisplay(borrowerFirstName, borrowerLastName, borrowerEmail) || this.readString(data['borrower']);
    const itemId = this.readString(data['toolId']) || this.readString(data['itemId']);

    if (!itemId) {
      return null;
    }

    return {
      id,
      itemId,
      borrowerId,
      borrower: borrowerDisplay,
      borrowerEmail,
      borrowerFirstName,
      borrowerLastName,
      loanDate: this.readDateString(data['loanDate']),
      returnDate: this.readDateString(data['returnDate']),
    };
  }

  private parseNotification(documentSnapshot: QueryDocumentSnapshot<DocumentData>): AppNotificationRecord | null {
    const data = documentSnapshot.data();
    const title = this.readString(data['title']);
    const message = this.readString(data['message']);
    const type = this.readString(data['type']);
    if (!title || !message || !this.isNotificationType(type)) {
      return null;
    }

    return {
      id: documentSnapshot.id,
      type,
      title,
      message,
      actorUserId: this.readString(data['actorUserId']),
      actorFirstName: this.readString(data['actorFirstName']) || 'Someone',
      recipientId: this.readString(data['recipientId']),
      createdAt: this.readDateTimeString(data['createdAt']),
    };
  }

  private notificationsQueries(userId: string, indexed = true) {
    const notifications = collection(this.firebase.firestore, 'notifications');
    const recipientIds = [userId];
    const ordering = indexed ? [orderBy('createdAt', 'desc'), limit(NOTIFICATION_QUERY_LIMIT)] : [limit(NOTIFICATION_QUERY_LIMIT)];
    return [
      query(notifications, where('recipientId', 'in', recipientIds), ...ordering),
      query(notifications, where('recipientId', 'in', ['']), ...ordering),
    ];
  }

  private isMissingNotificationIndex(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { code, message } = error as { code?: string; message?: string };
    return code === 'failed-precondition' && /index/i.test(message ?? '');
  }

  private isPermissionDenied(error: unknown): boolean {
    return Boolean(error && typeof error === 'object'
      && 'code' in error && error.code === 'permission-denied');
  }

  private boundNotificationsSnapshot(documents: QueryDocumentSnapshot<DocumentData>[]): AppNotificationRecord[] {
    // The bounded fallback uses automatic indexes. Deploy the composite index
    // for guaranteed newest-first results; never scan an unbounded history.
    return mergeNotifications([this.parseNotificationsSnapshot(documents)])
      .filter((notification) => Boolean(notification.createdAt))
      .slice(0, NOTIFICATION_QUERY_LIMIT);
  }

  private parseNotificationsSnapshot(
    documentSnapshots: QueryDocumentSnapshot<DocumentData>[],
  ): AppNotificationRecord[] {
    return documentSnapshots
      .map((documentSnapshot) => this.parseNotification(documentSnapshot))
      .filter((notification): notification is AppNotificationRecord => Boolean(notification));
  }

  private async loadCategories(): Promise<ToolCategoryRecord[]> {
    try {
      const categoriesSnapshot = await getDocs(query(collection(this.firebase.firestore, 'categories'), orderBy('order', 'asc')));
      const categories = categoriesSnapshot.docs
        .map((documentSnapshot) => this.parseCategory(documentSnapshot.id, documentSnapshot.data()))
        .filter((category): category is ToolCategoryRecord => Boolean(category));
      return categories.length ? categories : FIXED_TOOL_CATEGORIES;
    } catch {
      return FIXED_TOOL_CATEGORIES;
    }
  }

  private resolveCategory(categoryId: unknown): ToolCategoryRecord {
    const normalizedCategoryId = this.readString(categoryId) || 'other';
    return FIXED_TOOL_CATEGORIES.find((category) => category.id === normalizedCategoryId) ?? FIXED_TOOL_CATEGORIES.at(-1)!;
  }

  private async resolveSavedCategory(categoryId: string): Promise<ToolCategoryRecord> {
    const id = categoryId.trim();
    const category = FIXED_TOOL_CATEGORIES.find(category => category.id === id)
      ?? (await this.cachedCategories()).find(category => category.id === id);
    if (!category) throw new Error('This category is no longer available. Refresh and choose another category.');
    return category;
  }

  private readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readBoolean(value: unknown): boolean {
    return value === true || this.readString(value).toLowerCase() === 'true';
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => this.readString(item)).filter(Boolean) : [];
  }

  private readDateString(value: unknown): string {
    if (value instanceof Timestamp) {
      return value.toDate().toISOString().slice(0, 10);
    }

    const rawValue = this.readString(value);
    if (!rawValue) {
      return '';
    }

    const parsedDate = new Date(rawValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return rawValue;
    }

    return parsedDate.toISOString().slice(0, 10);
  }

  private readDateTimeString(value: unknown): string {
    if (value instanceof Timestamp) {
      return value.toDate().toISOString();
    }

    const rawValue = this.readString(value);
    if (!rawValue) {
      return '';
    }

    const parsedDate = new Date(rawValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return rawValue;
    }

    return parsedDate.toISOString();
  }

  private isNotificationType(value: string): value is AppNotificationRecord['type'] {
    return value === 'borrow' || value === 'tool-request';
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
