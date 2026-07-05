export interface UserProfile {
  email: string;
  name: string;
  picture: string;
}

export interface ToolRecord {
  id: string;
  name: string;
  description: string;
  notes: string;
  owner: string;
  images: string[];
  rowNumber: number;
}

export interface LoanRecord {
  itemId: string;
  person: string;
  loanDate: string;
  returnDate: string;
  rowNumber: number;
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
  images: string;
}

export interface SheetsSnapshot {
  tools: ToolRecord[];
  loans: LoanRecord[];
}
