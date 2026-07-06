# Lilies Shed

Lilies Shed is an Angular Material PWA backed by a shared Google Sheet. Users sign in with Google, browse tool listings from the `Tools` tab, borrow and return items through the `Status` tab, and manage the tools they own.

## Stack

- Angular `22.0.x`
- Angular Material `22.0.x`
- Angular service worker for PWA support
- Google Identity Services for sign-in
- Google Sheets API for read/write inventory actions

## Local setup

1. Install dependencies:

```bash
npm install
```

Use `nvm use` to switch to the repo-pinned Node version from `.nvmrc` if needed.

2. Update `src/environments/environment.ts` and `src/environments/environment.development.ts` with your Firebase web app config:

```json
{
  "appName": "Lilies Shed",
  "version": "1.0.0",
  "firebaseApiKey": "YOUR_FIREBASE_API_KEY",
  "firebaseAuthDomain": "YOUR_PROJECT.firebaseapp.com",
  "firebaseProjectId": "YOUR_PROJECT_ID",
  "firebaseStorageBucket": "YOUR_PROJECT.firebasestorage.app",
  "firebaseMessagingSenderId": "YOUR_SENDER_ID",
  "firebaseAppId": "YOUR_FIREBASE_APP_ID",
  "firebaseMeasurementId": "YOUR_MEASUREMENT_ID",
  "imgbbApiKey": "YOUR_IMGBB_API_KEY"
}
```

3. In Google Cloud:

- Enable the Google Sheets API.
- Create an OAuth client for a web application.
- Add your local origin such as `http://localhost:4200` or `http://127.0.0.1:4200`.
- Make sure the signed-in Google account can edit the target spreadsheet.

4. Start the app:

```bash
npm start
```

## Available scripts

```bash
npm start
npm run build
npm test -- --watch=false
```

## Behavior

- `Tools`: Lists sheet items with availability based on active rows in `Status`.
- `Borrowed`: Shows active loans for the signed-in user and allows marking them returned.
- `My Tools`: Lets the signed-in user add tools and edit owned tools that are not currently loaned out.

The PWA manifest locks the installed app to portrait orientation, and tools without images use a local placeholder asset.
