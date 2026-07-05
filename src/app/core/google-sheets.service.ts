import { Injectable } from '@angular/core';

import { APP_SETTINGS } from './app-settings';
import { LoanRecord, SheetsSnapshot, ToolFormValue, ToolRecord } from './models';

type Primitive = string | number;

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

  async addBorrowRequest(accessToken: string, toolId: string, person: string): Promise<void> {
    await this.appendRow(accessToken, APP_SETTINGS.statusSheetName, [
      this.today(),
      '',
      toolId,
      person,
    ]);
  }

  async markReturned(accessToken: string, loan: LoanRecord): Promise<void> {
    await this.updateRange(
      accessToken,
      `${APP_SETTINGS.statusSheetName}!B${loan.rowNumber}:B${loan.rowNumber}`,
      [[this.today()]],
    );
  }

  async addTool(accessToken: string, formValue: ToolFormValue, owner: string): Promise<void> {
    const currentTools = await this.readSheet(accessToken, `${APP_SETTINGS.toolsSheetName}!A:A`);
    const ids = currentTools
      .slice(1)
      .map((row) => Number(row[0] ?? 0))
      .filter((value) => !Number.isNaN(value));
    const nextId = (ids.length ? Math.max(...ids) : 99999) + 1;

    await this.appendRow(accessToken, APP_SETTINGS.toolsSheetName, [
      nextId,
      formValue.name,
      formValue.description,
      formValue.notes,
      owner,
      formValue.images,
    ]);
  }

  async updateTool(accessToken: string, tool: ToolRecord, formValue: ToolFormValue): Promise<void> {
    await this.updateRange(
      accessToken,
      `${APP_SETTINGS.toolsSheetName}!A${tool.rowNumber}:F${tool.rowNumber}`,
      [[tool.id, formValue.name, formValue.description, formValue.notes, tool.owner, formValue.images]],
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
      throw new Error('Google Sheets request failed.');
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
      .map((row, index) => ({
        id: this.readCell(row, headers, 'id'),
        name: this.readCell(row, headers, 'name'),
        description: this.readCell(row, headers, 'description'),
        notes: this.readCell(row, headers, 'notes'),
        owner: this.readCell(row, headers, 'owner'),
        images: this.parseImages(this.readCell(row, headers, 'images')),
        rowNumber: index + 2,
      }))
      .filter((tool) => Boolean(tool.id && tool.name));
  }

  private parseLoans(values: string[][]): LoanRecord[] {
    if (!values.length) {
      return [];
    }

    const headers = this.createHeaderMap(values[0]);

    return values
      .slice(1)
      .map((row, index) => ({
        loanDate: this.readCell(row, headers, 'loan date'),
        returnDate: this.readCell(row, headers, 'return date'),
        itemId: this.readCell(row, headers, 'item'),
        person: this.readCell(row, headers, 'person'),
        rowNumber: index + 2,
      }))
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

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
