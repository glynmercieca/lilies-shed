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

If your global Node.js runtime is older than Angular 22 requires, the project automatically prefers a workspace-local Node runtime from `.tools/node-v22.22.3-win-x64` when it exists.

2. Update `public/app-config.json` with a Google OAuth client ID:

```json
{
  "appName": "Lilies Shed",
  "googleClientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "spreadsheetId": "1ZmAkBYhR6y5JeRD5qF_gcC6_wBQzjm3QZMOQkJml4XU",
  "toolsSheetName": "Tools",
  "statusSheetName": "Status",
  "sheetsScope": "https://www.googleapis.com/auth/spreadsheets"
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
