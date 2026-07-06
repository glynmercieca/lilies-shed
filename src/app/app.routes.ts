import { Routes } from '@angular/router';

import { AboutViewComponent } from './about-view';
import { BorrowedViewComponent } from './borrowed-view';
import { authGuard } from './core/auth.guard';
import { homeRedirectGuard } from './core/home-redirect.guard';
import { HomeViewComponent } from './home-view';
import { MyToolsViewComponent } from './my-tools-view';
import { PrivacyViewComponent } from './privacy-view';
import { ToolsViewComponent } from './tools-view';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomeViewComponent, canActivate: [homeRedirectGuard] },
  { path: 'about', component: AboutViewComponent },
  { path: 'privacy', component: PrivacyViewComponent },
  { path: 'shed', component: ToolsViewComponent, canActivate: [authGuard] },
  { path: 'borrowed', component: BorrowedViewComponent, canActivate: [authGuard] },
  { path: 'my-tools', component: MyToolsViewComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'home' },
];
