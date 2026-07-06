const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const db = getFirestore();
const messaging = getMessaging();
const FUNCTION_REGION = 'europe-west1';
const APP_LINK = process.env.APP_LINK || 'https://shed.lilies.world/my-tools';
const APP_ICON = process.env.APP_ICON || 'https://shed.lilies.world/icons/icon-192x192.png';

exports.notifyOwnerOnBorrow = onDocumentCreated(
  {
    document: 'loan/{loanId}',
    region: FUNCTION_REGION,
  },
  async (event) => {
    const loan = event.data?.data();
    if (!loan) {
      return;
    }

    await notifyOwner(loan, 'borrowed');
  },
);

exports.notifyOwnerOnReturn = onDocumentUpdated(
  {
    document: 'loan/{loanId}',
    region: FUNCTION_REGION,
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

    await notifyOwner(after, 'returned');
  },
);

exports.notifyUsersOnToolRequest = onDocumentCreated(
  {
    document: 'toolRequests/{requestId}',
    region: FUNCTION_REGION,
  },
  async (event) => {
    const toolRequest = event.data?.data();
    if (!toolRequest) {
      return;
    }

    await notifyUsersOfToolRequest(toolRequest);
  },
);

async function notifyOwner(loan, eventType) {
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
  const tokens = readStringArray(owner.notificationTokens);
  if (!tokens.length) {
    logger.info('Owner has no notification tokens.', { ownerId, toolId });
    return;
  }

  const borrowerId = readString(loan.borrowerId);
  const borrowerName = await resolveBorrowerName(borrowerId, loan);
  const toolName = readString(tool.name) || readString(tool.id) || 'An item';
  const message = buildMessage(tokens, toolName, borrowerName, eventType);

  const response = await messaging.sendEachForMulticast(message);
  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (!result.success && isInvalidTokenError(result.error?.code)) {
      invalidTokens.push(tokens[index]);
    }
  });

  if (invalidTokens.length) {
    await db.collection('users').doc(ownerId).update({
      notificationTokens: FieldValue.arrayRemove(...invalidTokens),
    });
  }
}

async function resolveBorrowerName(borrowerId, loan) {
  if (borrowerId) {
    const borrowerSnapshot = await db.collection('users').doc(borrowerId).get();
    if (borrowerSnapshot.exists) {
      const borrower = borrowerSnapshot.data() || {};
      return (
        readString(borrower.displayName) ||
        [readString(borrower.firstName), readString(borrower.lastName)].filter(Boolean).join(' ') ||
        readString(borrower.email) ||
        'Someone'
      );
    }
  }

  return readString(loan.borrower) || 'Someone';
}

async function notifyUsersOfToolRequest(toolRequest) {
  const message = readString(toolRequest.message);
  if (!message) {
    logger.warn('Tool request missing message.', { toolRequest });
    return;
  }

  const usersSnapshot = await db.collection('users').get();
  const tokenOwners = new Map();

  usersSnapshot.forEach((documentSnapshot) => {
    const user = documentSnapshot.data() || {};
    const tokens = readStringArray(user.notificationTokens);
    tokens.forEach((token) => tokenOwners.set(token, documentSnapshot.id));
  });

  const tokens = [...tokenOwners.keys()];
  if (!tokens.length) {
    logger.info('No user notification tokens found for tool request.');
    return;
  }

  const body = message;
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: 'Tool Request',
      body,
    },
    webpush: {
      notification: {
        title: 'Tool Request',
        body,
        icon: APP_ICON,
      },
      fcmOptions: {
        link: APP_LINK,
      },
    },
  });

  const invalidTokensByUser = new Map();
  response.responses.forEach((result, index) => {
    if (!result.success && isInvalidTokenError(result.error?.code)) {
      const token = tokens[index];
      const userId = tokenOwners.get(token);
      if (!userId) {
        return;
      }

      const userTokens = invalidTokensByUser.get(userId) || [];
      userTokens.push(token);
      invalidTokensByUser.set(userId, userTokens);
    }
  });

  await Promise.all(
    [...invalidTokensByUser.entries()].map(([userId, invalidTokens]) =>
      db.collection('users').doc(userId).update({
        notificationTokens: FieldValue.arrayRemove(...invalidTokens),
      }),
    ),
  );
}

function buildMessage(tokens, toolName, borrowerName, eventType) {
  const title = eventType === 'returned' ? `${toolName} returned` : `${toolName} borrowed`;
  const body =
    eventType === 'returned'
      ? `${borrowerName} returned your item.`
      : `${borrowerName} borrowed your item.`;

  return {
    tokens,
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
        link: APP_LINK,
      },
    },
  };
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value) {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function isInvalidTokenError(code) {
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}
