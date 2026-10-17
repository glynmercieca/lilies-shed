import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { vi } from 'vitest';

import { App } from './app';
import { routes } from './app.routes';
import { ToolboxStateService } from './core/toolbox-state.service';
import { FirebaseClientService } from './core/firebase-client.service';
import { FirebaseMessagingService } from './core/firebase-messaging.service';
import { VersionCheckService } from './core/version-check.service';
import { UserProfile } from './core/models';

describe('App', () => {
  let currentUser: ReturnType<typeof signal<UserProfile | null>>;
  afterEach(() => window.localStorage.removeItem('shed-theme-mode'));
  beforeEach(async () => {
    // JSDOM does not implement the browser theme preference API.
    window.localStorage.setItem('shed-theme-mode', 'light');
    currentUser = signal<UserProfile | null>(null);
    await TestBed.configureTestingModule({
      imports: [App, MatSnackBarModule],
      providers: [
        provideZonelessChangeDetection(), provideNoopAnimations(), provideRouter(routes),
        {
          provide: ToolboxStateService,
          useValue: {
            auth: { currentUser },
            loading: signal(false),
            online: signal(true),
            recentNotifications: signal([]),
            unreadNotificationCount: signal(0),
          },
        },
        {
          provide: FirebaseMessagingService,
          useValue: { notificationOpenRequests: signal(0), foregroundNotification: signal(null) },
        },
        { provide: VersionCheckService, useValue: { start: vi.fn() } },
        // A shell render must never initialize a live Firebase client.
        {
          provide: FirebaseClientService,
          useFactory: () => { throw new Error('The app-shell test must not access Firebase.'); },
        },
      ],
    }).compileComponents();
  });

  it('should create the app shell', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    expect(app).toBeTruthy();
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.app-shell')).toBeTruthy();
  });

  it('renders signed-in navigation from controlled account state', () => {
    currentUser.set({ id: 'member', name: 'Member', email: '', firstName: 'Member', lastName: '', picture: '' });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="App header"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.bottom-nav a')).toHaveLength(4);
  });
});
