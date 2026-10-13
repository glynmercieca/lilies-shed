import { Injectable, inject } from '@angular/core';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseClientService } from './firebase-client.service';
import { prepareImage } from './image-processing.util';
import { normalizeImageUrl } from './image-url.util';

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly auth = inject(FirebaseAuthService);

  async uploadImage(file: File | null): Promise<{ imageUrl: string; thumbnailUrl: string } | null> {
    if (!file) return null;
    const user = this.auth.currentUser();
    if (!user) throw new Error('You must be signed in to upload an image.');
    const images = await prepareImage(file);
    const basePath = 'tools/' + user.id + '/' + Date.now() + '-' + crypto.randomUUID();
    const upload = async (blob: Blob, suffix: string) => {
      const extension = blob.type === 'image/webp' ? 'webp' : 'png';
      const storageRef = ref(this.firebase.storage, basePath + '-' + suffix + '.' + extension);
      await uploadBytes(storageRef, blob, {
        cacheControl: 'public,max-age=31536000,immutable',
        contentType: blob.type,
      });
      return normalizeImageUrl(await getDownloadURL(storageRef));
    };
    const [imageUrl, thumbnailUrl] = await Promise.all([
      upload(images.detail, 'detail'),
      upload(images.thumbnail, 'thumb'),
    ]);
    return { imageUrl, thumbnailUrl };
  }
}
