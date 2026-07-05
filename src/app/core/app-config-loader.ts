import { applyAppSettings, AppSettings, DEFAULT_APP_SETTINGS } from './app-settings';

function configUrl(): string {
  return new URL('app-config.json', document.baseURI).toString();
}

export async function loadAppSettings(): Promise<void> {
  try {
    const response = await fetch(configUrl(), {
      cache: 'no-store',
    });

    if (!response.ok) {
      applyAppSettings(DEFAULT_APP_SETTINGS);
      return;
    }

    const overrides = (await response.json()) as Partial<AppSettings>;
    applyAppSettings(overrides);
  } catch {
    applyAppSettings(DEFAULT_APP_SETTINGS);
  }
}
