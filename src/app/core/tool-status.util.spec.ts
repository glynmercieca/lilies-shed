import { describe, expect, it } from 'vitest';

import { decorateTools } from './tool-status.util';
import { SheetsSnapshot } from './models';

describe('decorateTools', () => {
  it('marks tools with active loans as unavailable', () => {
    const snapshot: SheetsSnapshot = {
      categories: [],
      notifications: [],
      tools: [
        {
          documentId: '100000',
          id: '100000',
          name: 'Crimper',
          categoryId: 'other',
          categoryName: 'Other',
          description: 'desc',
          notes: '',
          deleted: false,
          ownerId: 'user-1',
          owner: 'Glyn',
          ownerEmail: 'glyn@example.com',
          ownerFirstName: 'Glyn',
          ownerLastName: '',
          image: '',
        },
        {
          documentId: '100001',
          id: '100001',
          name: 'Tester',
          categoryId: 'other',
          categoryName: 'Other',
          description: 'desc',
          notes: '',
          deleted: false,
          ownerId: 'user-1',
          owner: 'Glyn',
          ownerEmail: 'glyn@example.com',
          ownerFirstName: 'Glyn',
          ownerLastName: '',
          image: '',
        },
      ],
      loans: [
        {
          id: 'loan-1',
          itemId: '100000',
          borrowerId: 'user-1',
          borrower: 'Glyn Mercieca <glyn@example.com>',
          borrowerEmail: 'glyn@example.com',
          borrowerFirstName: 'Glyn',
          borrowerLastName: 'Mercieca',
          loanDate: '2026-07-01',
          returnDate: '',
        },
        {
          id: 'loan-2',
          itemId: '100001',
          borrowerId: 'user-1',
          borrower: 'Glyn Mercieca <glyn@example.com>',
          borrowerEmail: 'glyn@example.com',
          borrowerFirstName: 'Glyn',
          borrowerLastName: 'Mercieca',
          loanDate: '2026-07-01',
          returnDate: '2026-07-04',
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
      categories: [],
      notifications: [],
      tools: [
        {
          documentId: '100002',
          id: '100002',
          name: 'Never Loaned',
          categoryId: 'other',
          categoryName: 'Other',
          description: 'desc',
          notes: '',
          deleted: false,
          ownerId: 'user-1',
          owner: 'Glyn',
          ownerEmail: 'glyn@example.com',
          ownerFirstName: 'Glyn',
          ownerLastName: '',
          image: '',
        },
      ],
      loans: [],
    };

    const [tool] = decorateTools(snapshot);
    expect(tool.available).toBe(true);
  });
});
