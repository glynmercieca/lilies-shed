export interface AppSettings {
  appName: string;
  googleClientId: string;
  spreadsheetId: string;
  toolsSheetName: string;
  statusSheetName: string;
  sheetsScope: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appName: 'Lilies Shed',
  googleClientId: '',
  spreadsheetId: '1ZmAkBYhR6y5JeRD5qF_gcC6_wBQzjm3QZMOQkJml4XU',
  toolsSheetName: 'Tools',
  statusSheetName: 'Status',
  sheetsScope: 'https://www.googleapis.com/auth/spreadsheets',
};

export let APP_SETTINGS: AppSettings = { ...DEFAULT_APP_SETTINGS };

export function applyAppSettings(overrides: Partial<AppSettings>): void {
  APP_SETTINGS = {
    ...DEFAULT_APP_SETTINGS,
    ...overrides,
  };
}
