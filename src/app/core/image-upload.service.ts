import { Injectable, inject } from '@angular/core';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseClientService } from './firebase-client.service';
import { normalizeImageUrl } from './image-url.util';

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly auth = inject(FirebaseAuthService);

  async uploadImage(file: File | null): Promise<string> {
    if (!file) {
      return '';
    }

    const user = this.auth.currentUser();
    if (!user) {
      throw new Error('You must be signed in to upload an image.');
    }

    const storageRef = ref(
      this.firebase.storage,
      `tools/${user.id}/${Date.now()}-${crypto.randomUUID()}.${this.resolveExtension(file)}`,
    );

    await uploadBytes(storageRef, file, {
      cacheControl: 'public,max-age=31536000,immutable',
      contentType: file.type || 'application/octet-stream',
    });

    return normalizeImageUrl(await getDownloadURL(storageRef));
  }

  private resolveExtension(file: File): string {
    const fileName = file.name.trim();
    const nameExtension = fileName.includes('.') ? fileName.split('.').pop()?.trim().toLowerCase() : '';
    if (nameExtension) {
      return nameExtension.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'bin';
    }

    const mimeExtension = file.type.split('/').pop()?.trim().toLowerCase();
    if (mimeExtension) {
      return mimeExtension.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'bin';
    }

    return 'bin';
  }
}
