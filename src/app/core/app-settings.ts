import { environment } from '../../environments/environment';

export interface AppSettings {
  appName: string;
  version: string;
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  firebaseStorageBucket: string;
  firebaseMessagingSenderId: string;
  firebaseAppId: string;
  firebaseMeasurementId: string;
  firebaseVapidKey: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ...environment.appSettings,
};

export const APP_SETTINGS: AppSettings = { ...DEFAULT_APP_SETTINGS };
