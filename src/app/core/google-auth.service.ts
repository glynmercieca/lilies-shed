import { Injectable, computed, signal } from '@angular/core';

import { APP_SETTINGS } from './app-settings';
import { UserProfile } from './models';

interface StoredGoogleSession {
  expiresAt: number;
  token: string;
  user: UserProfile;
}

const STORAGE_KEY = 'lilies-toolbox.google-session';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

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
  readonly isConfigured = computed(() => Boolean(APP_SETTINGS.googleClientId.trim()));

  constructor() {
    this.restoreSession();
  }

  async signIn(): Promise<void> {
    if (!this.isConfigured()) {
      this.errorMessage.set('Add a Google OAuth client ID in public/app-config.json before signing in.');
      return;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    try {
      const tokenResponse = await this.requestAccessToken(this.token() ? '' : 'consent');
      const accessToken = tokenResponse.access_token;
      const profile = await this.fetchProfile(accessToken);
      this.setSession(profile, accessToken, tokenResponse.expires_in);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Google sign-in failed.');
      this.clearSessionState();
    } finally {
      this.busy.set(false);
    }
  }

  signOut(): void {
    const currentToken = this.token();
    if (currentToken && window.google?.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(currentToken, () => undefined);
    }

    this.clearSessionState();
    this.clearStoredSession();
    this.errorMessage.set(null);
  }

  async ensureValidSession(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    const storedSession = this.readStoredSession();
    if (!storedSession) {
      return Boolean(this.token() && this.user());
    }

    const now = Date.now();
    if (storedSession.expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
      if (!this.token() || !this.user()) {
        this.setSession(storedSession.user, storedSession.token, Math.floor((storedSession.expiresAt - now) / 1000));
      }
      return true;
    }

    try {
      this.busy.set(true);
      const tokenResponse = await this.requestAccessToken('');
      const profile = this.user() ?? storedSession.user ?? (await this.fetchProfile(tokenResponse.access_token));
      this.setSession(profile, tokenResponse.access_token, tokenResponse.expires_in);
      return true;
    } catch {
      this.clearSessionState();
      this.clearStoredSession();
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private restoreSession(): void {
    const storedSession = this.readStoredSession();
    if (!storedSession) {
      return;
    }

    const now = Date.now();
    if (storedSession.expiresAt > now) {
      this.token.set(storedSession.token);
      this.user.set(storedSession.user);
      queueMicrotask(() => {
        void this.ensureValidSession();
      });
      return;
    }

    queueMicrotask(() => {
      void this.ensureValidSession();
    });
  }

  private setSession(user: UserProfile, token: string, expiresInSeconds: number): void {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    this.token.set(token);
    this.user.set(user);
    this.errorMessage.set(null);
    this.writeStoredSession({
      user,
      token,
      expiresAt,
    });
  }

  private clearSessionState(): void {
    this.token.set(null);
    this.user.set(null);
  }

  private async requestAccessToken(prompt: '' | 'consent'): Promise<GoogleTokenResponse> {
    await this.waitForGoogleIdentity();

    return new Promise<GoogleTokenResponse>((resolve, reject) => {
      const tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: APP_SETTINGS.googleClientId,
        scope: `openid email profile ${APP_SETTINGS.sheetsScope}`,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error('Google did not return an access token.'));
            return;
          }

          resolve(response);
        },
        error_callback: () => reject(new Error('Google sign-in was cancelled or blocked.')),
      });

      tokenClient.requestAccessToken({ prompt });
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

  private readStoredSession(): StoredGoogleSession | null {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as StoredGoogleSession;
    } catch {
      return null;
    }
  }

  private writeStoredSession(session: StoredGoogleSession): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Ignore storage failures and keep the in-memory session.
    }
  }

  private clearStoredSession(): void {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }
}
