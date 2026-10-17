import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { arrayRemove, doc, runTransaction, setDoc, updateDoc } from 'firebase/firestore';
import type { Messaging } from 'firebase/messaging';

import { APP_SETTINGS } from './app-settings';
import { FirebaseClientService } from './firebase-client.service';
import { UserProfile } from './models';

const TOKEN_STORAGE_KEY = 'lilies-shed.fcm-token';
const MESSAGING_SW_URL = '/firebase-messaging-sw.js';
const MESSAGING_SW_SCOPE = '/firebase-cloud-messaging-push-scope';
const FOREGROUND_MESSAGE_DURATION_MS = 8000;

export interface ForegroundNotification {
  title: string;
  body: string;
}

export const OPEN_NOTIFICATIONS_MESSAGE = 'lilies-shed:open-notifications';

@Injectable({ providedIn: 'root' })
export class FirebaseMessagingService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly snackBar = inject(MatSnackBar);
  private supportPromise: Promise<boolean> | null = null;
  private sdkPromise: Promise<typeof import('firebase/messaging')> | null = null;
  private foregroundListenerAttached = false;
  private readonly receivedNotificationIds = new Set<string>();
  private serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;
  readonly foregroundNotification = signal<ForegroundNotification | null>(null);
  readonly notificationOpenRequests = signal(0);
  private foregroundNotificationTimer: ReturnType<typeof window.setTimeout> | null = null;

  private sdk(): Promise<typeof import('firebase/messaging')> {
    return this.sdkPromise ??= import('firebase/messaging').catch(error => {
      this.sdkPromise = null;
      throw error;
    });
  }

  private supported(): Promise<boolean> {
    if (!APP_SETTINGS.firebaseVapidKey.trim()) return Promise.resolve(false);
    return this.supportPromise ??= this.sdk().then(sdk => sdk.isSupported()).catch(() => false);
  }

  async canPromptForNotifications(): Promise<boolean> {
    if (!(await this.supported())) {
      return false;
    }

    return Notification.permission === 'default';
  }

  async syncCurrentUser(user: UserProfile, options?: { requestPermission?: boolean }): Promise<void> {
    if (!(await this.supported())) {
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

    try {
      const sdk = await this.sdk();
      const messaging = sdk.getMessaging(this.firebase.app);
      const serviceWorkerRegistration = await this.registerServiceWorker();
      await serviceWorkerRegistration.update();
      const token = await sdk.getToken(messaging, {
        vapidKey: APP_SETTINGS.firebaseVapidKey,
        serviceWorkerRegistration,
      });

      if (!token) {
        await setDoc(
          doc(this.firebase.firestore, 'users', user.id),
          {
            notificationsEnabled: false,
            lastNotificationTokenError: 'FCM did not return a registration token.',
          },
          { merge: true },
        );
        return;
      }

      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      const userRef = doc(this.firebase.firestore, 'users', user.id);
      await runTransaction(this.firebase.firestore, async transaction => {
        const snapshot = await transaction.get(userRef);
        const existing = snapshot.data()?.['notificationTokens'];
        const tokens = Array.isArray(existing) ? existing.filter((value): value is string => typeof value === 'string' && value !== token) : [];
        transaction.set(userRef, {
          notificationsEnabled: true,
          notificationPermission: permission,
          notificationTokens: [...new Set(tokens), token].slice(-20),
          lastNotificationTokenAt: new Date().toISOString(),
          lastNotificationTokenError: '',
        }, { merge: true });
      });

      this.attachForegroundListener(sdk, messaging);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to register push notifications.';
      await setDoc(
        doc(this.firebase.firestore, 'users', user.id),
        {
          notificationsEnabled: false,
          lastNotificationTokenError: message,
        },
        { merge: true },
      );
      throw error;
    }
  }

  async clearCurrentUserToken(userId: string): Promise<void> {
    if (!(await this.supported())) {
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
      const sdk = await this.sdk();
      await sdk.deleteToken(sdk.getMessaging(this.firebase.app));
    } catch {
      // Ignore deleteToken failures and continue clearing local state.
    }

    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  private attachForegroundListener(sdk: typeof import('firebase/messaging'), messaging: Messaging): void {
    if (this.foregroundListenerAttached) {
      return;
    }

    sdk.onMessage(messaging, (payload) => {
      const notificationId = payload.data?.['notificationId'];
      if (notificationId) {
        if (this.receivedNotificationIds.has(notificationId)) return;
        this.receivedNotificationIds.add(notificationId);
        if (this.receivedNotificationIds.size > 100) this.receivedNotificationIds.delete(this.receivedNotificationIds.values().next().value!);
      }
      const title = payload.notification?.title?.trim() || 'Lilies Shed';
      const body = payload.notification?.body?.trim() || 'You have a new toolbox update.';
      this.showForegroundNotification({ title, body });
      this.snackBar.open(`${title}: ${body}`, 'Close', { duration: 6000 });

      if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
          body,
          tag: notificationId,
          icon: payload.notification?.image || '/notification-icon.png',
        });
        notification.onclick = () => {
          window.focus();
          this.requestNotificationsOpen();
          notification.close();
        };
      }
    });

    this.foregroundListenerAttached = true;
  }

  dismissForegroundNotification(): void {
    if (this.foregroundNotificationTimer) {
      window.clearTimeout(this.foregroundNotificationTimer);
      this.foregroundNotificationTimer = null;
    }

    this.foregroundNotification.set(null);
  }

  requestNotificationsOpen(): void {
    this.notificationOpenRequests.update((value) => value + 1);
  }

  private showForegroundNotification(notification: ForegroundNotification): void {
    this.foregroundNotification.set(notification);

    if (this.foregroundNotificationTimer) {
      window.clearTimeout(this.foregroundNotificationTimer);
    }

    this.foregroundNotificationTimer = window.setTimeout(() => {
      this.foregroundNotification.set(null);
      this.foregroundNotificationTimer = null;
    }, FOREGROUND_MESSAGE_DURATION_MS);
  }

  private registerServiceWorker(): Promise<ServiceWorkerRegistration> {
    if (!this.serviceWorkerRegistrationPromise) {
      this.serviceWorkerRegistrationPromise = navigator.serviceWorker
        .getRegistration('/')
        .then(async (rootRegistration) => {
          if (rootRegistration?.active?.scriptURL.endsWith(MESSAGING_SW_URL)) {
            await rootRegistration.unregister();
          }
        })
        .then(() =>
          navigator.serviceWorker.register(MESSAGING_SW_URL, {
            scope: MESSAGING_SW_SCOPE,
          }),
        )
        .then((registration) => registration);
    }

    return this.serviceWorkerRegistrationPromise;
  }
}
