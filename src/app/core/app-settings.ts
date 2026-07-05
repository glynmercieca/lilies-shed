export interface AppSettings {
  appName: string;
  version: string;
  googleClientId: string;
  spreadsheetId: string;
  toolsSheetName: string;
  statusSheetName: string;
  sheetsScope: string;
  driveFileScope: string;
  imgbbApiKey: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appName: 'Lilies Shed',
  version: '1.0.0',
  googleClientId: '',
  spreadsheetId: '1ZmAkBYhR6y5JeRD5qF_gcC6_wBQzjm3QZMOQkJml4XU',
  toolsSheetName: 'Tools',
  statusSheetName: 'Status',
  sheetsScope: 'https://www.googleapis.com/auth/spreadsheets',
  driveFileScope: 'https://www.googleapis.com/auth/drive',
  imgbbApiKey: '86d672f1de34b21c4f8c2d32ac97b76e',
};

export let APP_SETTINGS: AppSettings = { ...DEFAULT_APP_SETTINGS };

export function applyAppSettings(overrides: Partial<AppSettings>): void {
  APP_SETTINGS = {
    ...DEFAULT_APP_SETTINGS,
    ...overrides,
  };
}
