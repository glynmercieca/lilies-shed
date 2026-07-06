importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyD7CU6Omy-PuizKKjKApWxyz9jiwghoD0A',
  authDomain: 'shed-3fc03.firebaseapp.com',
  projectId: 'shed-3fc03',
  storageBucket: 'shed-3fc03.firebasestorage.app',
  messagingSenderId: '391381086192',
  appId: '1:391381086192:web:9dd4ef13664e97d76fb735',
  measurementId: 'G-G7V312KBDZ',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.info('[Lilies Shed SW] Background push received.', {
    notification: payload.notification ?? null,
    data: payload.data ?? null,
    fcmOptions: payload.fcmOptions ?? null,
  });

  const title = payload.notification?.title?.trim() || 'Lilies Shed';
  const body = payload.notification?.body?.trim() || 'You have a new toolbox update.';
  const link =
    payload.data?.link ||
    payload.fcmOptions?.link ||
    payload.notification?.click_action ||
    payload.data?.click_action ||
    '/shed';

  console.info('[Lilies Shed SW] Showing notification.', {
    title,
    body,
    link,
  });

  self.registration.showNotification(title, {
    body,
    icon: payload.notification?.image || '/icons/icon-192x192.png',
    data: { link },
  });
});

self.addEventListener('notificationclick', (event) => {
  console.info('[Lilies Shed SW] Notification clicked.', {
    notificationData: event.notification?.data ?? null,
  });

  event.notification?.close();

  const fallbackUrl = '/shed';
  const notificationData = event.notification?.data ?? {};
  const targetUrl =
    notificationData.link ||
    notificationData.FCM_MSG?.notification?.click_action ||
    notificationData.FCM_MSG?.fcmOptions?.link ||
    fallbackUrl;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client && client.url.startsWith(self.location.origin)) {
          client.navigate?.(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return Promise.resolve();
    }),
  );
});
