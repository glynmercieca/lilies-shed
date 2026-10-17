const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { createNotificationDelivery } = require('./notification-delivery');

initializeApp();

const db = getFirestore();
const messaging = getMessaging();
const { createNotification, sendPush } = createNotificationDelivery({ db, messaging, FieldValue });
const FUNCTION_REGION = 'europe-west1';
const APP_LINK = process.env.APP_LINK || 'https://shed.lilies.world/my-tools';
const APP_ICON = process.env.APP_ICON || 'https://shed.lilies.world/notification-icon.png';
const APP_NOTIFICATION_LINK = withNotificationsOpenParam(APP_LINK);

exports.notifyOwnerOnBorrow = onDocumentCreated(
  {
    document: 'loan/{loanId}',
    region: FUNCTION_REGION,
    retry: true,
    timeoutSeconds: 300,
  },
  async (event) => {
    const loan = event.data?.data();
    if (!loan) {
      return;
    }

    await notifyOwner(loan, 'borrowed', event.id);
  },
);

exports.notifyOwnerOnReturn = onDocumentUpdated(
  {
    document: 'loan/{loanId}',
    region: FUNCTION_REGION,
    retry: true,
    timeoutSeconds: 300,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) {
      return;
    }

    const beforeReturnDate = readString(before.returnDate);
    const afterReturnDate = readString(after.returnDate);
    if (beforeReturnDate || !afterReturnDate) {
      return;
    }

    await notifyOwner(after, 'returned', event.id);
  },
);

exports.notifyUsersOnToolRequest = onDocumentCreated(
  {
    document: 'requests/{requestId}',
    region: FUNCTION_REGION,
    retry: true,
    timeoutSeconds: 300,
  },
  async (event) => {
    const toolRequest = event.data?.data();
    if (!toolRequest) {
      return;
    }

    await notifyUsersOfToolRequest(toolRequest, event.id);
  },
);

async function notifyOwner(loan, eventType, eventId) {
  const toolId = readString(loan.toolId) || readString(loan.itemId);
  if (!toolId) {
    logger.warn('Loan is missing toolId/itemId.', { loan });
    return;
  }

  const toolSnapshot = await db.collection('tools').doc(toolId).get();
  if (!toolSnapshot.exists) {
    logger.warn('Tool document not found for loan notification.', { toolId });
    return;
  }

  const tool = toolSnapshot.data() || {};
  const ownerId = readString(tool.ownerId);
  if (!ownerId) {
    logger.warn('Tool is missing ownerId.', { toolId });
    return;
  }

  const ownerSnapshot = await db.collection('users').doc(ownerId).get();
  if (!ownerSnapshot.exists) {
    logger.warn('Owner document not found for loan notification.', { ownerId, toolId });
    return;
  }

  const owner = ownerSnapshot.data() || {};
  const borrowerId = readString(loan.borrowerId);
  const borrowerSummary = await resolveUserSummary(borrowerId, loan.borrower, 'Someone');
  const toolName = readString(tool.name) || readString(tool.id) || 'An item';
  const notification = buildNotificationPayload(toolName, borrowerSummary.displayName, eventType);

  const notificationId = await createNotification(eventId, {
    type: 'borrow',
    title: notification.notification.title,
    message: notification.notification.body,
    actorUserId: borrowerId,
    actorFirstName: borrowerSummary.firstName,
    recipientId: ownerId,
  });

  const tokens = owner.notificationsEnabled === false || owner.active === false ? [] : readStringArray(owner.notificationTokens);
  if (!tokens.length) {
    return;
  }

  await sendPush(notificationId, notification, tokens, async invalidTokens => {
    if (invalidTokens.length) await db.collection('users').doc(ownerId).update({
      notificationTokens: FieldValue.arrayRemove(...invalidTokens),
    });
  });
}

async function resolveUserSummary(userId, fallbackDisplayName, emptyFallback) {
  if (userId) {
    const userSnapshot = await db.collection('publicProfiles').doc(userId).get();
    if (userSnapshot.exists) {
      const user = userSnapshot.data() || {};
      const displayName =
        readString(user.displayName) ||
        [readString(user.firstName), readString(user.lastName)].filter(Boolean).join(' ') ||
        emptyFallback;

      return {
        displayName,
        firstName: firstNameFromDisplay(readString(user.firstName) || displayName) || emptyFallback,
      };
    }
  }

  const displayName = readString(fallbackDisplayName) || emptyFallback;
  return {
    displayName,
    firstName: firstNameFromDisplay(displayName) || emptyFallback,
  };
}

async function notifyUsersOfToolRequest(toolRequest, eventId) {
  const message = readString(toolRequest.message);
  if (!message) {
    logger.warn('Tool request missing message.', { toolRequest });
    return;
  }

  const requesterId = readString(toolRequest.requesterId);
  const requesterSummary = await resolveUserSummary(requesterId, '', 'Someone');

  const notificationId = await createNotification(eventId, {
    type: 'tool-request',
    title: 'Tool Request',
    message,
    actorUserId: requesterId,
    actorFirstName: requesterSummary.firstName,
    recipientId: '',
  });

  const usersSnapshot = await db.collection('users').get();
  const tokenOwners = new Map();

  usersSnapshot.forEach((documentSnapshot) => {
    if (documentSnapshot.id === requesterId) {
      return;
    }

    const user = documentSnapshot.data() || {};
    if (user.notificationsEnabled === false || user.active === false) return;
    const tokens = readStringArray(user.notificationTokens);
    tokens.forEach((token) => tokenOwners.set(token, documentSnapshot.id));
  });

  const tokens = [...tokenOwners.keys()];
  if (!tokens.length) {
    return;
  }

  await sendPush(notificationId, {
    data: {
      link: APP_NOTIFICATION_LINK,
    },
    notification: {
      title: 'Tool Request',
      body: message,
    },
    webpush: {
      notification: {
        title: 'Tool Request',
        body: message,
        icon: APP_ICON,
      },
      fcmOptions: {
        link: APP_NOTIFICATION_LINK,
      },
    },
  }, tokens, async invalidTokens => {
    const invalidTokensByUser = new Map();
    invalidTokens.forEach(token => {
      const userId = tokenOwners.get(token);
      const values = invalidTokensByUser.get(userId) || [];
      values.push(token);
      invalidTokensByUser.set(userId, values);
    });
    await Promise.all([...invalidTokensByUser].map(([userId, values]) =>
      db.collection('users').doc(userId).update({ notificationTokens: FieldValue.arrayRemove(...values) })));
  });
}

function buildNotificationPayload(toolName, borrowerName, eventType) {
  const title = eventType === 'returned' ? `${toolName} returned` : `${toolName} borrowed`;
  const body =
    eventType === 'returned'
      ? `${borrowerName} returned your item.`
      : `${borrowerName} borrowed your item.`;

  return {
    data: {
      link: APP_NOTIFICATION_LINK,
    },
    notification: {
      title,
      body,
    },
    webpush: {
      notification: {
        title,
        body,
        icon: APP_ICON,
      },
      fcmOptions: {
        link: APP_NOTIFICATION_LINK,
      },
    },
  };
}

function withNotificationsOpenParam(value) {
  try {
    const url = new URL(value);
    url.searchParams.set('notifications', 'open');
    return url.href;
  } catch {
    return 'https://shed.lilies.world/shed?notifications=open';
  }
}

function firstNameFromDisplay(value) {
  const displayName = readString(value);
  if (!displayName) {
    return '';
  }

  return displayName.split(/\s+/)[0] || '';
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value) {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}
