import { Routes } from '@angular/router';

import { authGuard } from './core/auth.guard';
import { homeRedirectGuard } from './core/home-redirect.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    loadComponent: () => import('./home-view').then((m) => m.HomeViewComponent),
    canActivate: [homeRedirectGuard],
  },
  { path: 'about', loadComponent: () => import('./about-view').then((m) => m.AboutViewComponent) },
  {
    path: 'privacy',
    loadComponent: () => import('./privacy-view').then((m) => m.PrivacyViewComponent),
  },
  {
    path: 'loading',
    loadComponent: () => import('./loading-view').then((m) => m.LoadingViewComponent),
    canActivate: [authGuard],
  },
  {
    path: 'shed',
    loadComponent: () => import('./shed-view').then((m) => m.ShedViewComponent),
    canActivate: [authGuard],
  },
  {
    path: 'borrowed',
    loadComponent: () => import('./borrowed-view').then((m) => m.BorrowedViewComponent),
    canActivate: [authGuard],
  },
  {
    path: 'my-tools',
    loadComponent: () => import('./my-tools-view').then((m) => m.MyToolsView),
    canActivate: [authGuard],
  },
  {
    path: 'options',
    loadComponent: () => import('./options-view').then((m) => m.OptionsViewComponent),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'home' },
];
