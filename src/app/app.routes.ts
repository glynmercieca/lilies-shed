import { Routes } from '@angular/router';

import { AboutViewComponent } from './about-view';
import { BorrowedViewComponent } from './borrowed-view';
import { authGuard } from './core/auth.guard';
import { HomeViewComponent } from './home-view';
import { MyToolsViewComponent } from './my-tools-view';
import { PrivacyViewComponent } from './privacy-view';
import { ToolsViewComponent } from './tools-view';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomeViewComponent },
  { path: 'about', component: AboutViewComponent },
  { path: 'privacy', component: PrivacyViewComponent },
  { path: 'tools', component: ToolsViewComponent, canActivate: [authGuard] },
  { path: 'borrowed', component: BorrowedViewComponent, canActivate: [authGuard] },
  { path: 'my-tools', component: MyToolsViewComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'home' },
];
