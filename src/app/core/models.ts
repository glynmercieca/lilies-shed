export interface UserProfile {
  id: string;
  email: string;
  name: string;
  picture: string;
  firstName: string;
  lastName: string;
}

export interface ToolRecord {
  documentId: string;
  id: string;
  name: string;
  description: string;
  notes: string;
  deleted: boolean;
  ownerId: string;
  owner: string;
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
  image: string;
}

export interface LoanRecord {
  id: string;
  itemId: string;
  borrowerId: string;
  borrower: string;
  borrowerEmail: string;
  borrowerFirstName: string;
  borrowerLastName: string;
  loanDate: string;
  returnDate: string;
}

export interface AppNotificationRecord {
  id: string;
  type: 'borrow' | 'tool-request';
  title: string;
  message: string;
  actorUserId: string;
  actorFirstName: string;
  recipientId: string;
  createdAt: string;
}

export interface ToolWithStatus extends ToolRecord {
  available: boolean;
  activeLoan?: LoanRecord;
  latestLoan?: LoanRecord;
}

export interface ToolFormValue {
  name: string;
  description: string;
  notes: string;
  imageUrl: string;
  imageFile: File | null;
}

export interface SheetsSnapshot {
  tools: ToolRecord[];
  loans: LoanRecord[];
  notifications: AppNotificationRecord[];
}
