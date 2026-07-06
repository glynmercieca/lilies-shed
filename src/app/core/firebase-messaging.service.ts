import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { arrayRemove, arrayUnion, doc, setDoc, updateDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

import { APP_SETTINGS } from './app-settings';
import { FirebaseClientService } from './firebase-client.service';
import { UserProfile } from './models';

const TOKEN_STORAGE_KEY = 'lilies-shed.fcm-token';
const MESSAGING_SCOPE = '/firebase-cloud-messaging-push-scope';
const MESSAGING_SW_URL = '/firebase-messaging-sw.js';

@Injectable({ providedIn: 'root' })
export class FirebaseMessagingService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly supportPromise = isSupported().catch(() => false);
  private foregroundListenerAttached = false;
  private serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

  async canPromptForNotifications(): Promise<boolean> {
    if (!(await this.supportPromise) || !APP_SETTINGS.firebaseVapidKey.trim()) {
      return false;
    }

    return Notification.permission === 'default';
  }

  async syncCurrentUser(user: UserProfile, options?: { requestPermission?: boolean }): Promise<void> {
    if (!(await this.supportPromise) || !APP_SETTINGS.firebaseVapidKey.trim()) {
      return;
    }

    let permission = Notification.permission;
    if (options?.requestPermission && permission === 'default') {
      permission = await Notification.requestPermission();
    }

    await setDoc(
      doc(this.firebase.firestore, 'users', user.id),
      {
        notificationsEnabled: permission === 'granted',
        notificationPermission: permission,
      },
      { merge: true },
    );

    if (permission !== 'granted') {
      return;
    }

    const messaging = getMessaging(this.firebase.app);
    const serviceWorkerRegistration = await this.registerServiceWorker();
    const token = await getToken(messaging, {
      vapidKey: APP_SETTINGS.firebaseVapidKey,
      serviceWorkerRegistration,
    });

    if (!token) {
      return;
    }

    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    await setDoc(
      doc(this.firebase.firestore, 'users', user.id),
      {
        notificationsEnabled: true,
        notificationPermission: permission,
        notificationTokens: arrayUnion(token),
      },
      { merge: true },
    );

    this.attachForegroundListener(messaging);
  }

  async clearCurrentUserToken(userId: string): Promise<void> {
    if (!(await this.supportPromise) || !APP_SETTINGS.firebaseVapidKey.trim()) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      return;
    }

    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      return;
    }

    try {
      await updateDoc(doc(this.firebase.firestore, 'users', userId), {
        notificationTokens: arrayRemove(token),
      });
    } catch {
      // Ignore cleanup failures during sign-out.
    }

    try {
      await deleteToken(getMessaging(this.firebase.app));
    } catch {
      // Ignore deleteToken failures and continue clearing local state.
    }

    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  private attachForegroundListener(messaging: ReturnType<typeof getMessaging>): void {
    if (this.foregroundListenerAttached) {
      return;
    }

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title?.trim() || 'Lilies Shed';
      const body = payload.notification?.body?.trim() || 'You have a new toolbox update.';
      this.snackBar.open(`${title}: ${body}`, 'Close', { duration: 6000 });
    });

    this.foregroundListenerAttached = true;
  }

  private registerServiceWorker(): Promise<ServiceWorkerRegistration> {
    if (!this.serviceWorkerRegistrationPromise) {
      this.serviceWorkerRegistrationPromise = navigator.serviceWorker.register(MESSAGING_SW_URL, {
        scope: MESSAGING_SCOPE,
      });
    }

    return this.serviceWorkerRegistrationPromise;
  }
}
