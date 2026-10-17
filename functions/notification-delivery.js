const { createHash, randomUUID } = require('node:crypto');

const key = value => createHash('sha256').update(value).digest('hex');

function createNotificationDelivery({ db, messaging, FieldValue }) {
  async function createNotification(eventId, notification) {
    const id = key(eventId);
    try {
      await db.collection('notifications').doc(id).create({
        ...notification, createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if (error.code !== 6 && error.code !== 'already-exists') throw error;
    }
    return id;
  }

  async function sendPush(id, payload, tokens, cleanInvalidTokens) {
    const delivery = db.collection('notificationDeliveries').doc(id);
    const lease = randomUUID();
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(delivery);
      if ((snapshot.data()?.leaseUntil ?? 0) > Date.now()) throw new Error('Notification delivery is already running; retry later.');
      transaction.set(delivery, { lease, leaseUntil: Date.now() + 360_000 });
    });
    const invalid = [];
    let retry = false;
    try {
      const unique = [...new Set(tokens)].sort();
      for (let offset = 0; offset < unique.length; offset += 500) {
        const group = unique.slice(offset, offset + 500);
        const references = group.map(token => delivery.collection('tokens').doc(key(token)));
        const previous = await db.getAll(...references);
        const pending = group.filter((token, index) => {
          if (previous[index].data()?.invalid) invalid.push(token);
          return !previous[index].exists;
        });
        if (!pending.length) continue;
        const response = await messaging.sendEachForMulticast({
          ...payload,
          data: { ...payload.data, notificationId: id },
          webpush: { ...payload.webpush, notification: { ...payload.webpush?.notification, tag: id } },
          tokens: pending,
        });
        const batch = db.batch();
        response.responses.forEach((result, index) => {
          const token = pending[index];
          const permanent = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code);
          if (permanent) invalid.push(token);
          if (result.success || permanent) {
            batch.set(delivery.collection('tokens').doc(key(token)), { invalid: permanent, completedAt: FieldValue.serverTimestamp() });
          } else retry = true;
        });
        await batch.commit();
      }
      await cleanInvalidTokens(invalid);
      if (retry) throw new Error('Some push notifications failed temporarily; retrying unfinished tokens.');
    } finally {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(delivery);
        if (snapshot.data()?.lease === lease) transaction.set(delivery, { lease: '', leaseUntil: 0 });
      });
    }
  }
  return { createNotification, sendPush };
}

module.exports = { createNotificationDelivery };
