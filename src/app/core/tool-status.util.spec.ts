import { describe, expect, it } from 'vitest';

import { decorateTools } from './tool-status.util';
import { SheetsSnapshot } from './models';

describe('decorateTools', () => {
  it('marks tools with active loans as unavailable', () => {
    const snapshot: SheetsSnapshot = {
      tools: [
        {
          id: '100000',
          name: 'Crimper',
          description: 'desc',
          notes: '',
          owner: 'Glyn',
          ownerEmail: 'glyn@example.com',
          ownerFirstName: 'Glyn',
          ownerLastName: '',
          images: [],
          rowNumber: 2,
        },
        {
          id: '100001',
          name: 'Tester',
          description: 'desc',
          notes: '',
          owner: 'Glyn',
          ownerEmail: 'glyn@example.com',
          ownerFirstName: 'Glyn',
          ownerLastName: '',
          images: [],
          rowNumber: 3,
        },
      ],
      loans: [
        {
          itemId: '100000',
          borrower: 'Glyn Mercieca <glyn@example.com>',
          borrowerEmail: 'glyn@example.com',
          borrowerFirstName: 'Glyn',
          borrowerLastName: 'Mercieca',
          loanDate: '2026-07-01',
          returnDate: '',
          rowNumber: 2,
        },
        {
          itemId: '100001',
          borrower: 'Glyn Mercieca <glyn@example.com>',
          borrowerEmail: 'glyn@example.com',
          borrowerFirstName: 'Glyn',
          borrowerLastName: 'Mercieca',
          loanDate: '2026-07-01',
          returnDate: '2026-07-04',
          rowNumber: 3,
        },
      ],
    };

    const [activeLoanTool, returnedTool] = decorateTools(snapshot);

    expect(activeLoanTool.available).toBe(false);
    expect(activeLoanTool.activeLoan?.borrowerFirstName).toBe('Glyn');
    expect(returnedTool.available).toBe(true);
    expect(returnedTool.activeLoan).toBeUndefined();
  });

  it('marks never-loaned tools as available', () => {
    const snapshot: SheetsSnapshot = {
      tools: [
        {
          id: '100002',
          name: 'Never Loaned',
          description: 'desc',
          notes: '',
          owner: 'Glyn',
          ownerEmail: 'glyn@example.com',
          ownerFirstName: 'Glyn',
          ownerLastName: '',
          images: [],
          rowNumber: 4,
        },
      ],
      loans: [],
    };

    const [tool] = decorateTools(snapshot);
    expect(tool.available).toBe(true);
  });
});
