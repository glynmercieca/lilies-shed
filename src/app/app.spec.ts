import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  afterEach(() => window.localStorage.removeItem('shed-theme-mode'));
  beforeEach(async () => {
    // JSDOM does not implement the browser theme preference API.
    window.localStorage.setItem('shed-theme-mode', 'light');
    await TestBed.configureTestingModule({
      imports: [App, MatSnackBarModule],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations(), provideRouter(routes)],
    }).compileComponents();
  });

  it('should create the app shell', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
