self.addEventListener('notificationclick', (event) => {
  event.notification?.close();

  const fallbackUrl = '/my-tools';
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
