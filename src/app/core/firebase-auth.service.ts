import { Injectable, computed, inject, signal } from '@angular/core';
import { User, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { APP_SETTINGS } from './app-settings';
import { FirebaseClientService } from './firebase-client.service';
import { splitUserName } from './identity.util';
import { UserProfile } from './models';

@Injectable({ providedIn: 'root' })
export class FirebaseAuthService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly user = signal<UserProfile | null>(null);
  private readonly busy = signal(false);
  private readonly errorMessage = signal<string | null>(null);
  private readonly authReady: Promise<void>;

  readonly currentUser = computed(() => this.user());
  readonly isBusy = computed(() => this.busy());
  readonly error = computed(() => this.errorMessage());
  readonly isConfigured = computed(
    () => Boolean(APP_SETTINGS.firebaseApiKey.trim() && APP_SETTINGS.firebaseProjectId.trim()),
  );

  constructor() {
    this.authReady = new Promise<void>((resolve) => {
      onIdTokenChanged(this.firebase.auth, async (firebaseUser) => {
        try {
          if (firebaseUser) {
            const userProfile = this.mapUser(firebaseUser);
            this.user.set(userProfile);
            await this.upsertUserDocument(userProfile);
          } else {
            this.user.set(null);
          }
        } catch (error) {
          // A profile-write failure does not invalidate Firebase authentication.
          // Keep the account usable while profile rules/migrations roll out.
          this.errorMessage.set(error instanceof Error ? error.message : 'Unable to restore the Firebase session.');
        } finally {
          resolve();
        }
      });
    });
  }

  async signIn(): Promise<UserProfile | null> {
    if (!this.isConfigured()) {
      this.errorMessage.set('Add Firebase web config in src/environments/environment*.ts before signing in.');
      return null;
    }

    this.busy.set(true);
    this.errorMessage.set(null);

    try {
      const credential = await signInWithPopup(this.firebase.auth, this.firebase.googleProvider);
      const userProfile = this.mapUser(credential.user);
      this.user.set(userProfile);
      void this.upsertUserDocument(userProfile).catch((error) => {
        this.errorMessage.set(error instanceof Error ? error.message : 'Unable to update the user profile.');
      });
      return userProfile;
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Google sign-in failed.');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  async signOut(): Promise<void> {
    await signOut(this.firebase.auth);
    this.errorMessage.set(null);
  }

  async ensureValidSession(): Promise<boolean> {
    await this.authReady;

    const firebaseUser = this.firebase.auth.currentUser;
    if (!firebaseUser) {
      return false;
    }

    try {
      await firebaseUser.getIdToken();
      return true;
    } catch {
      await signOut(this.firebase.auth);
      return false;
    }
  }

  private mapUser(firebaseUser: User): UserProfile {
    const email = firebaseUser.email?.trim().toLowerCase() ?? '';
    const name = firebaseUser.displayName?.trim() || email;
    const { firstName, lastName } = splitUserName(name);

    return {
      id: firebaseUser.uid,
      email,
      name,
      picture: firebaseUser.photoURL?.trim() ?? '',
      firstName,
      lastName,
    };
  }

  private async upsertUserDocument(user: UserProfile): Promise<void> {
    // Only this explicit display projection is shared with other members.
    const firstName = user.firstName.includes('@') ? '' : user.firstName.slice(0, 100);
    const lastName = user.lastName.includes('@') ? '' : user.lastName.slice(0, 100);
    await setDoc(doc(this.firebase.firestore, 'publicProfiles', user.id), {
      displayName: [firstName, lastName].filter(Boolean).join(' ').slice(0, 200) || 'Member',
      firstName,
      lastName,
      photoURL: user.picture.slice(0, 2048),
    });
    const userRef = doc(this.firebase.firestore, 'users', user.id);
    const snapshot = await getDoc(userRef);

    await setDoc(
      userRef,
      {
        email: user.email,
        displayName: user.name.slice(0, 320),
        firstName: user.firstName.slice(0, 100),
        lastName: user.lastName.slice(0, 100),
        photoURL: user.picture.slice(0, 2048),
        active: true,
        lastLoginAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true },
    );
  }
}
