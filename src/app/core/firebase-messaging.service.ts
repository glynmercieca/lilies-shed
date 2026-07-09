import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { arrayRemove, arrayUnion, doc, setDoc, updateDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

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
  private readonly supportPromise = isSupported().catch(() => false);
  private foregroundListenerAttached = false;
  private serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;
  readonly foregroundNotification = signal<ForegroundNotification | null>(null);
  readonly notificationOpenRequests = signal(0);
  private foregroundNotificationTimer: ReturnType<typeof window.setTimeout> | null = null;

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

    try {
      const messaging = getMessaging(this.firebase.app);
      const serviceWorkerRegistration = await this.registerServiceWorker();
      await serviceWorkerRegistration.update();
      const token = await getToken(messaging, {
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
      await setDoc(
        doc(this.firebase.firestore, 'users', user.id),
        {
          notificationsEnabled: true,
          notificationPermission: permission,
          notificationTokens: arrayUnion(token),
          lastNotificationTokenAt: new Date().toISOString(),
          lastNotificationTokenError: '',
        },
        { merge: true },
      );

      this.attachForegroundListener(messaging);
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
      this.showForegroundNotification({ title, body });
      this.snackBar.open(`${title}: ${body}`, 'Close', { duration: 6000 });

      if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
          body,
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
