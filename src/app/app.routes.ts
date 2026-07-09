import { Routes } from '@angular/router';

import { AboutViewComponent } from './about-view';
import { BorrowedViewComponent } from './borrowed-view';
import { authGuard } from './core/auth.guard';
import { homeRedirectGuard } from './core/home-redirect.guard';
import { HomeViewComponent } from './home-view';
import { LoadingViewComponent } from './loading-view';
import { OptionsViewComponent } from './options-view';
import { PrivacyViewComponent } from './privacy-view';
import { ShedViewComponent } from './shed-view';
import { MyToolsView } from './my-tools-view';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomeViewComponent, canActivate: [homeRedirectGuard] },
  { path: 'about', component: AboutViewComponent },
  { path: 'privacy', component: PrivacyViewComponent },
  { path: 'loading', component: LoadingViewComponent, canActivate: [authGuard] },
  { path: 'shed', component: ShedViewComponent, canActivate: [authGuard] },
  { path: 'borrowed', component: BorrowedViewComponent, canActivate: [authGuard] },
  { path: 'my-tools', component: MyToolsView, canActivate: [authGuard] },
  { path: 'options', component: OptionsViewComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'home' },
];
