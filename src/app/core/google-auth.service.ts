import { Injectable, computed, signal } from '@angular/core';

import { APP_SETTINGS, GOOGLE_CLIENT_ID_PLACEHOLDER } from './app-settings';
import { UserProfile } from './models';

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private readonly token = signal<string | null>(null);
  private readonly user = signal<UserProfile | null>(null);
  private readonly busy = signal(false);
  private readonly errorMessage = signal<string | null>(null);

  readonly currentUser = computed(() => this.user());
  readonly accessToken = computed(() => this.token());
  readonly isBusy = computed(() => this.busy());
  readonly error = computed(() => this.errorMessage());
  readonly isConfigured = APP_SETTINGS.googleClientId !== GOOGLE_CLIENT_ID_PLACEHOLDER;

  async signIn(): Promise<void> {
    if (!this.isConfigured) {
      this.errorMessage.set('Add a Google OAuth client ID in app-settings.ts before signing in.');
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    try {
      const accessToken = await this.requestAccessToken();
      const profile = await this.fetchProfile(accessToken);
      this.token.set(accessToken);
      this.user.set(profile);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Google sign-in failed.');
      this.token.set(null);
      this.user.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  signOut(): void {
    const currentToken = this.token();
    if (currentToken && window.google?.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(currentToken, () => undefined);
    }

    this.token.set(null);
    this.user.set(null);
    this.errorMessage.set(null);
  }

  private async requestAccessToken(): Promise<string> {
    await this.waitForGoogleIdentity();

    return new Promise<string>((resolve, reject) => {
      const tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: APP_SETTINGS.googleClientId,
        scope: `openid email profile ${APP_SETTINGS.sheetsScope}`,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error('Google did not return an access token.'));
            return;
          }

          resolve(response.access_token);
        },
        error_callback: () => reject(new Error('Google sign-in was cancelled or blocked.')),
      });

      tokenClient.requestAccessToken({ prompt: this.token() ? '' : 'consent' });
    });
  }

  private async fetchProfile(accessToken: string): Promise<UserProfile> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Google profile lookup failed.');
    }

    const payload = (await response.json()) as {
      email?: string;
      name?: string;
      picture?: string;
    };

    return {
      email: payload.email ?? '',
      name: payload.name ?? '',
      picture: payload.picture ?? '',
    };
  }

  private async waitForGoogleIdentity(): Promise<void> {
    if (window.google?.accounts.oauth2) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Google sign-in script did not load.')), 10000);
      const check = () => {
        if (window.google?.accounts.oauth2) {
          window.clearTimeout(timeout);
          resolve();
          return;
        }

        window.setTimeout(check, 100);
      };

      check();
    });
  }
}
