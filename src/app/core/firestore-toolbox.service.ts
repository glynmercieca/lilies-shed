import { Injectable, inject } from '@angular/core';
import {
  QueryDocumentSnapshot,
  DocumentData,
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { FirebaseClientService } from './firebase-client.service';
import { formatOwnerDisplay, splitUserName } from './identity.util';
import { AppNotificationRecord, LoanRecord, SheetsSnapshot, ToolFormValue, ToolRecord, UserProfile } from './models';
import { ToolRequestFormValue } from '../request-tool-dialog';

interface FirestoreUserRecord {
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string;
}

@Injectable({ providedIn: 'root' })
export class FirestoreToolboxService {
  private readonly firebase = inject(FirebaseClientService);

  async loadSnapshot(): Promise<SheetsSnapshot> {
    const [usersSnapshot, toolsSnapshot, loansSnapshot, notificationsSnapshot] = await Promise.all([
      getDocs(collection(this.firebase.firestore, 'users')),
      getDocs(collection(this.firebase.firestore, 'tools')),
      getDocs(collection(this.firebase.firestore, 'loan')),
      getDocs(query(collection(this.firebase.firestore, 'notifications'), orderBy('createdAt', 'desc'), limit(50))),
    ]);

    const usersById = new Map<string, UserProfile>(
      usersSnapshot.docs.map((documentSnapshot) => {
        const data = documentSnapshot.data() as FirestoreUserRecord;
        const email = this.readString(data.email).toLowerCase();
        const displayName = this.readString(data.displayName) || email || documentSnapshot.id;
        const firstName = this.readString(data.firstName) || splitUserName(displayName).firstName;
        const lastName = this.readString(data.lastName) || splitUserName(displayName).lastName;

        return [
          documentSnapshot.id,
          {
            id: documentSnapshot.id,
            email,
            name: displayName,
            picture: this.readString(data.photoURL),
            firstName,
            lastName,
          },
        ];
      }),
    );

    const tools = toolsSnapshot.docs
      .map((documentSnapshot) => this.parseTool(documentSnapshot.id, documentSnapshot.data(), usersById))
      .filter((tool): tool is ToolRecord => Boolean(tool));
    const loans = loansSnapshot.docs
      .map((documentSnapshot) => this.parseLoan(documentSnapshot.id, documentSnapshot.data(), usersById))
      .filter((loan): loan is LoanRecord => Boolean(loan));
    const notifications = notificationsSnapshot.docs
      .map((documentSnapshot) => this.parseNotification(documentSnapshot))
      .filter((notification): notification is AppNotificationRecord => Boolean(notification));

    return { tools, loans, notifications };
  }

  async addBorrowRequest(toolId: string, borrower: UserProfile): Promise<void> {
    const loanRef = doc(collection(this.firebase.firestore, 'loan'));
    await setDoc(loanRef, {
      toolId,
      borrowerId: borrower.id,
      loanDate: this.today(),
      returnDate: '',
      createdAt: serverTimestamp(),
    });
  }

  async markReturned(loan: LoanRecord): Promise<void> {
    await updateDoc(doc(this.firebase.firestore, 'loan', loan.id), {
      returnDate: this.today(),
      updatedAt: serverTimestamp(),
    });
  }

  async addTool(formValue: ToolFormValue, owner: UserProfile): Promise<void> {
    const nextId = await this.allocateNextToolId();
    const toolRef = doc(collection(this.firebase.firestore, 'tools'));
    await setDoc(toolRef, {
      id: nextId,
      name: formValue.name,
      description: formValue.description,
      notes: formValue.notes,
      deleted: false,
      ownerId: owner.id,
      image: formValue.imageUrl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async updateTool(tool: ToolRecord, formValue: ToolFormValue): Promise<void> {
    await updateDoc(doc(this.firebase.firestore, 'tools', tool.documentId), {
      name: formValue.name,
      description: formValue.description,
      notes: formValue.notes,
      image: formValue.imageUrl,
      updatedAt: serverTimestamp(),
    });
  }

  async markToolDeleted(tool: ToolRecord): Promise<void> {
    await updateDoc(doc(this.firebase.firestore, 'tools', tool.documentId), {
      deleted: true,
      updatedAt: serverTimestamp(),
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
      description: this.readString(data['description']),
      notes: this.readString(data['notes']),
      deleted: this.readBoolean(data['deleted']),
      ownerId,
      owner: ownerDisplay,
      ownerEmail,
      ownerFirstName,
      ownerLastName,
      image: this.readString(data['image']),
    };
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

  private async allocateNextToolId(): Promise<string> {
    const counterRef = doc(this.firebase.firestore, 'meta', 'counters');
    const existingMaxToolId = await this.fetchMaxToolId();

    return runTransaction(this.firebase.firestore, async (transaction) => {
      const snapshot = await transaction.get(counterRef);
      const currentValue = Number(snapshot.data()?.['nextToolId'] ?? existingMaxToolId + 1);
      const nextValue = Number.isFinite(currentValue) ? currentValue : existingMaxToolId + 1;

      transaction.set(counterRef, { nextToolId: nextValue + 1 }, { merge: true });
      return String(nextValue);
    });
  }

  private async fetchMaxToolId(): Promise<number> {
    const snapshot = await getDocs(query(collection(this.firebase.firestore, 'tools'), orderBy('id', 'desc')));
    const highestId = snapshot.docs
      .map((documentSnapshot) => Number(documentSnapshot.data()['id'] ?? documentSnapshot.id))
      .find((value) => Number.isFinite(value));

    return highestId ?? 99999;
  }

  private readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readBoolean(value: unknown): boolean {
    return value === true || this.readString(value).toLowerCase() === 'true';
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
