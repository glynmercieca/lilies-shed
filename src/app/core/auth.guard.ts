import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { GoogleAuthService } from './google-auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(GoogleAuthService);
  const router = inject(Router);

  if (auth.currentUser()) {
    return true;
  }

  return auth.ensureValidSession().then((isAuthenticated) => {
    if (isAuthenticated) {
      return true;
    }

    return router.createUrlTree(['/home'], {
      queryParams: { returnUrl: state.url },
    });
  });
};
