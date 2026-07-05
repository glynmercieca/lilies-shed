import { Injectable } from '@angular/core';

import { APP_SETTINGS } from './app-settings';
import { LoanRecord, SheetsSnapshot, ToolFormValue, ToolRecord } from './models';
import { formatOwnerDisplay, splitUserName } from './identity.util';

type Primitive = string | number;

interface ToolsSheetSchema {
  headerMap: Map<string, number>;
  headers: string[];
}

interface StatusSheetSchema {
  headers: string[];
}

@Injectable({ providedIn: 'root' })
export class GoogleSheetsService {
  async loadSnapshot(accessToken: string): Promise<SheetsSnapshot> {
    const [toolsValues, statusValues] = await Promise.all([
      this.readSheet(accessToken, `${APP_SETTINGS.toolsSheetName}!A:Z`),
      this.readSheet(accessToken, `${APP_SETTINGS.statusSheetName}!A:Z`),
    ]);

    return {
      tools: this.parseTools(toolsValues),
      loans: this.parseLoans(statusValues),
    };
  }

  async addBorrowRequest(accessToken: string, toolId: string, borrowerIdentity: string): Promise<void> {
    const schema = await this.readStatusSheetSchema(accessToken);
    const parsedBorrower = this.parseLegacyOwner(borrowerIdentity);
    const values = this.buildStatusRow(schema, {
      itemId: toolId,
      borrower:
        formatOwnerDisplay(parsedBorrower.firstName, parsedBorrower.lastName, parsedBorrower.email) || borrowerIdentity,
      borrowerFirstName: parsedBorrower.firstName,
      borrowerLastName: parsedBorrower.lastName,
      borrowerEmail: parsedBorrower.email,
      loanDate: this.today(),
      returnDate: '',
      rowNumber: 0,
    });

    await this.appendRow(accessToken, APP_SETTINGS.statusSheetName, values);
  }

  async markReturned(accessToken: string, loan: LoanRecord): Promise<void> {
    await this.updateRange(
      accessToken,
      `${APP_SETTINGS.statusSheetName}!B${loan.rowNumber}:B${loan.rowNumber}`,
      [[this.today()]],
    );
  }

  async addTool(accessToken: string, formValue: ToolFormValue, ownerName: string, ownerEmail: string): Promise<void> {
    const currentTools = await this.readSheet(accessToken, `${APP_SETTINGS.toolsSheetName}!A:A`);
    const schema = await this.readToolsSheetSchema(accessToken);
    const ids = currentTools
      .slice(1)
      .map((row) => Number(row[0] ?? 0))
      .filter((value) => !Number.isNaN(value));
    const nextId = (ids.length ? Math.max(...ids) : 99999) + 1;

    const ownerParts = splitUserName(ownerName);
    const rowValues = this.buildToolRow(schema, {
      id: String(nextId),
      name: formValue.name,
      description: formValue.description,
      notes: formValue.notes,
      owner: formatOwnerDisplay(ownerParts.firstName, ownerParts.lastName, ownerEmail),
      ownerFirstName: ownerParts.firstName,
      ownerLastName: ownerParts.lastName,
      ownerEmail,
      images: this.parseImages(formValue.images),
      rowNumber: 0,
    });

    await this.appendRow(accessToken, APP_SETTINGS.toolsSheetName, rowValues);
  }

  async updateTool(accessToken: string, tool: ToolRecord, formValue: ToolFormValue): Promise<void> {
    const schema = await this.readToolsSheetSchema(accessToken);
    const rowValues = this.buildToolRow(schema, {
      ...tool,
      name: formValue.name,
      description: formValue.description,
      notes: formValue.notes,
      images: this.parseImages(formValue.images),
    });

    await this.updateRange(
      accessToken,
      `${APP_SETTINGS.toolsSheetName}!A${tool.rowNumber}:${this.columnNameFromIndex(rowValues.length)}${tool.rowNumber}`,
      [rowValues],
    );
  }

  private async readSheet(accessToken: string, range: string): Promise<string[][]> {
    const response = await this.fetchSheets(accessToken, `values/${encodeURIComponent(range)}`);
    return ((await response.json()) as { values?: string[][] }).values ?? [];
  }

  private async appendRow(accessToken: string, sheetName: string, values: Primitive[]): Promise<void> {
    await this.fetchSheets(
      accessToken,
      `values/${encodeURIComponent(`${sheetName}!A:Z`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({
          values: [values],
        }),
      },
    );
  }

  private async readToolsSheetSchema(accessToken: string): Promise<ToolsSheetSchema> {
    const [headers = []] = await this.readSheet(accessToken, `${APP_SETTINGS.toolsSheetName}!1:1`);
    return {
      headers,
      headerMap: this.createHeaderMap(headers),
    };
  }

  private async readStatusSheetSchema(accessToken: string): Promise<StatusSheetSchema> {
    const [headers = []] = await this.readSheet(accessToken, `${APP_SETTINGS.statusSheetName}!1:1`);
    return { headers };
  }

  private async updateRange(accessToken: string, range: string, values: Primitive[][]): Promise<void> {
    await this.fetchSheets(accessToken, `values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: JSON.stringify({ values }),
    });
  }

  private async fetchSheets(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${APP_SETTINGS.spreadsheetId}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      let details = 'Google Sheets request failed.';

      try {
        const payload = (await response.json()) as {
          error?: {
            message?: string;
            status?: string;
          };
        };

        if (payload.error?.message) {
          details = payload.error.message;
        } else if (payload.error?.status) {
          details = `Google Sheets request failed: ${payload.error.status}.`;
        }
      } catch {
        // Keep the generic error when Google does not return JSON.
      }

      throw new Error(details);
    }

    return response;
  }

  private parseTools(values: string[][]): ToolRecord[] {
    if (!values.length) {
      return [];
    }

    const headers = this.createHeaderMap(values[0]);

    return values
      .slice(1)
      .map((row, index) => {
        const ownerFirstName =
          this.readCell(row, headers, 'owner first name') ||
          this.readCell(row, headers, 'owner firstname');
        const ownerLastName =
          this.readCell(row, headers, 'owner last name') ||
          this.readCell(row, headers, 'owner lastname');
        const ownerEmail = this.readCell(row, headers, 'owner email');
        const legacyOwner = this.readCell(row, headers, 'owner');
        const parsedLegacyOwner = this.parseLegacyOwner(legacyOwner);

        return {
          id: this.readCell(row, headers, 'id'),
          name: this.readCell(row, headers, 'name'),
          description: this.readCell(row, headers, 'description'),
          notes: this.readCell(row, headers, 'notes'),
          ownerFirstName: ownerFirstName || parsedLegacyOwner.firstName,
          ownerLastName: ownerLastName || parsedLegacyOwner.lastName,
          ownerEmail: ownerEmail || parsedLegacyOwner.email,
          owner:
            formatOwnerDisplay(
              ownerFirstName || parsedLegacyOwner.firstName,
              ownerLastName || parsedLegacyOwner.lastName,
              ownerEmail || parsedLegacyOwner.email,
            ) || legacyOwner,
          images: this.parseImages(this.readCell(row, headers, 'images')),
          rowNumber: index + 2,
        };
      })
      .filter((tool) => Boolean(tool.id && tool.name));
  }

  private parseLoans(values: string[][]): LoanRecord[] {
    if (!values.length) {
      return [];
    }

    const headers = this.createHeaderMap(values[0]);

    return values
      .slice(1)
      .map((row, index) => {
        const borrowerValue = this.readCell(row, headers, 'borrower');
        const parsedBorrower = this.parseLegacyOwner(borrowerValue);

        return {
          loanDate: this.readCell(row, headers, 'loan date'),
          returnDate: this.readCell(row, headers, 'return date'),
          itemId: this.readCell(row, headers, 'item'),
          borrower: borrowerValue,
          borrowerFirstName: parsedBorrower.firstName,
          borrowerLastName: parsedBorrower.lastName,
          borrowerEmail: parsedBorrower.email,
          rowNumber: index + 2,
        };
      })
      .filter((loan) => Boolean(loan.itemId));
  }

  private createHeaderMap(headers: string[]): Map<string, number> {
    return new Map(headers.map((header, index) => [this.normalizeHeader(header), index]));
  }

  private readCell(row: string[], headers: Map<string, number>, header: string): string {
    const index = headers.get(this.normalizeHeader(header));
    return index === undefined ? '' : String(row[index] ?? '').trim();
  }

  private normalizeHeader(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private parseImages(value: string): string[] {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private buildToolRow(schema: ToolsSheetSchema, tool: ToolRecord): Primitive[] {
    const headers = schema.headers.length
      ? schema.headers
      : ['Id', 'Name', 'Description', 'Notes', 'Owner', 'Images'];
    const values = new Array<Primitive>(headers.length).fill('');

    headers.forEach((header, index) => {
      const normalizedHeader = this.normalizeHeader(header);
      values[index] = this.valueForToolHeader(normalizedHeader, tool);
    });

    return values;
  }

  private valueForToolHeader(header: string, tool: ToolRecord): Primitive {
    switch (header) {
      case 'id':
        return tool.id;
      case 'name':
        return tool.name;
      case 'description':
        return tool.description;
      case 'notes':
        return tool.notes;
      case 'owner':
        return tool.owner;
      case 'owner first name':
      case 'owner firstname':
        return tool.ownerFirstName;
      case 'owner last name':
      case 'owner lastname':
        return tool.ownerLastName;
      case 'owner email':
        return tool.ownerEmail;
      case 'images':
        return tool.images.join('\n');
      default:
        return '';
    }
  }

  private parseLegacyOwner(value: string): { email: string; firstName: string; lastName: string } {
    const trimmedValue = value.trim();
    const emailMatch = trimmedValue.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = emailMatch ? emailMatch[0].toLowerCase() : '';
    const name = trimmedValue.replace(/<[^>]+>/g, '').trim();
    const { firstName, lastName } = splitUserName(name);

    return { firstName, lastName, email };
  }

  private buildStatusRow(schema: StatusSheetSchema, loan: LoanRecord): Primitive[] {
    const headers = schema.headers.length
      ? schema.headers
      : ['Loan Date', 'Return Date', 'Item', 'Borrower'];
    const values = new Array<Primitive>(headers.length).fill('');

    headers.forEach((header, index) => {
      const normalizedHeader = this.normalizeHeader(header);

      switch (normalizedHeader) {
        case 'loan date':
          values[index] = loan.loanDate;
          break;
        case 'return date':
          values[index] = loan.returnDate;
          break;
        case 'item':
          values[index] = loan.itemId;
          break;
        case 'borrower':
          values[index] = loan.borrower;
          break;
        default:
          values[index] = '';
      }
    });

    return values;
  }

  private columnNameFromIndex(length: number): string {
    let columnIndex = Math.max(length, 1);
    let columnName = '';

    while (columnIndex > 0) {
      const remainder = (columnIndex - 1) % 26;
      columnName = String.fromCharCode(65 + remainder) + columnName;
      columnIndex = Math.floor((columnIndex - 1) / 26);
    }

    return columnName;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
