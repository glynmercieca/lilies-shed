import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { FirebaseAuthService } from './firebase-auth.service';

export const homeRedirectGuard: CanActivateFn = async () => {
  const auth = inject(FirebaseAuthService);
  const router = inject(Router);

  if (auth.currentUser()) {
    return router.createUrlTree(['/shed']);
  }

  const isAuthenticated = await auth.ensureValidSession();
  if (isAuthenticated) {
    return router.createUrlTree(['/shed']);
  }

  return true;
};
