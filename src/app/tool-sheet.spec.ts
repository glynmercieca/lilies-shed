import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ToolSheetComponent, ToolSheetData } from './tool-sheet';
import { NetworkStatusService } from './core/network-status.service';

describe('offline tool actions', () => {
  it('labels cached availability as unknown and disables borrow until connected', () => {
    const online = signal(false);
    const availabilityVerified = signal(true);
    const data: ToolSheetData = {
      actionRequested: new Subject(), previewRequested: new Subject(), canBorrow: true, mode: 'shed', saving: false,
      tool: { documentId: 'tool', id: '100000', name: 'Drill', categoryId: 'other', categoryName: 'Other', description: '', notes: '', deleted: false, ownerId: 'owner', owner: 'Olivia', ownerEmail: '', ownerFirstName: 'Olivia', ownerLastName: '', image: '', available: true },
    };
    TestBed.configureTestingModule({ imports: [ToolSheetComponent], providers: [provideNoopAnimations(),
      { provide: MAT_BOTTOM_SHEET_DATA, useValue: data },
      { provide: MatBottomSheetRef, useValue: { dismiss: vi.fn() } },
      { provide: NetworkStatusService, useValue: { online, availabilityVerified } },
    ] });
    const fixture = TestBed.createComponent(ToolSheetComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const borrow = element.querySelector<HTMLButtonElement>('.tool-sheet-actions button')!;
    expect(element.querySelector('.tool-availability')?.textContent).toContain('Availability unknown offline');
    expect(borrow.disabled).toBe(true);
    online.set(true);
    fixture.detectChanges();
    expect(element.querySelector('.tool-availability')?.textContent?.trim()).toBe('Available');
    expect(borrow.disabled).toBe(false);
    availabilityVerified.set(false);
    fixture.detectChanges();
    expect(element.querySelector('.tool-availability')?.textContent).toContain('Availability not verified');
    expect(borrow.disabled).toBe(true);
    availabilityVerified.set(true);
    fixture.componentInstance.tool.set({ ...data.tool, available: false, activeLoanId: 'other-member-loan' });
    fixture.detectChanges();
    expect(element.querySelector('.tool-availability')?.textContent?.trim()).toBe('Not available');
    expect(element.querySelector('.tool-sheet-actions button')).toBeNull();
  });
});
