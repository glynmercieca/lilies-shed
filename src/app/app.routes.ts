import { Routes } from '@angular/router';
import { BorrowedViewComponent } from './borrowed-view';
import { MyToolsViewComponent } from './my-tools-view';
import { ToolsViewComponent } from './tools-view';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tools' },
  { path: 'tools', component: ToolsViewComponent },
  { path: 'borrowed', component: BorrowedViewComponent },
  { path: 'my-tools', component: MyToolsViewComponent },
  { path: '**', redirectTo: 'tools' },
];
