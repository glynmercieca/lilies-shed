import { Injectable } from '@angular/core';
import { FirebaseApp, FirebaseOptions, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, GoogleAuthProvider, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';

import { APP_SETTINGS } from './app-settings';

@Injectable({ providedIn: 'root' })
export class FirebaseClientService {
  private readonly appInstance: FirebaseApp;
  private readonly authInstance: Auth;
  private readonly firestoreInstance: Firestore;
  private readonly storageInstance: FirebaseStorage;
  private readonly googleProviderInstance: GoogleAuthProvider;

  constructor() {
    const options: FirebaseOptions = {
      apiKey: APP_SETTINGS.firebaseApiKey,
      authDomain: APP_SETTINGS.firebaseAuthDomain,
      projectId: APP_SETTINGS.firebaseProjectId,
      storageBucket: APP_SETTINGS.firebaseStorageBucket,
      messagingSenderId: APP_SETTINGS.firebaseMessagingSenderId,
      appId: APP_SETTINGS.firebaseAppId,
      measurementId: APP_SETTINGS.firebaseMeasurementId,
    };

    this.appInstance = getApps().length ? getApp() : initializeApp(options);
    this.authInstance = getAuth(this.appInstance);
    this.firestoreInstance = getFirestore(this.appInstance);
    this.storageInstance = getStorage(this.appInstance);
    this.googleProviderInstance = new GoogleAuthProvider();
    this.googleProviderInstance.setCustomParameters({
      prompt: 'select_account',
    });
  }

  get app(): FirebaseApp {
    return this.appInstance;
  }

  get auth(): Auth {
    return this.authInstance;
  }

  get firestore(): Firestore {
    return this.firestoreInstance;
  }

  get storage(): FirebaseStorage {
    return this.storageInstance;
  }

  get googleProvider(): GoogleAuthProvider {
    return this.googleProviderInstance;
  }
}
