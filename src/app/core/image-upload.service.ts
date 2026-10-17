import { Injectable, inject } from '@angular/core';

import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseClientService } from './firebase-client.service';
import { normalizeImageUrl } from './image-url.util';

export interface UploadedToolImages {
  imageUrl: string;
  thumbnailUrl: string;
}

@Injectable({ providedIn: 'root' })
export class ImagePreparationService {
  async prepare(file: File): Promise<{ detail: Blob; thumbnail: Blob }> {
    return (await import('./image-processing.util')).prepareImage(file);
  }
}

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  private readonly firebase = inject(FirebaseClientService);
  private readonly auth = inject(FirebaseAuthService);
  private readonly preparation = inject(ImagePreparationService);
  private readonly pendingUploads = new Map<UploadedToolImages, () => Promise<void>>();

  async uploadImage(file: File | null): Promise<UploadedToolImages | null> {
    if (!file) return null;
    const user = this.auth.currentUser();
    if (!user) throw new Error('You must be signed in to upload an image.');
    const [{ getStorage, getDownloadURL, ref, uploadBytes, deleteObject }, images] = await Promise.all([
      import('firebase/storage'), this.preparation.prepare(file),
    ]);
    const storage = getStorage(this.firebase.app);
    const basePath = 'tools/' + user.id + '/' + Date.now() + '-' + crypto.randomUUID();
    const uploadedPaths = new Set<string>();
    const cleanup = async () => {
      const results = await Promise.allSettled([...uploadedPaths].map(async path => {
        try { await deleteObject(ref(storage, path)); uploadedPaths.delete(path); }
        catch (error) {
          if ((error as { code?: string }).code === 'storage/object-not-found') uploadedPaths.delete(path);
          else throw error;
        }
      }));
      if (results.some(result => result.status === 'rejected')) throw new Error('Some unused uploads could not be removed; maintenance cleanup will retry them.');
    };
    const upload = async (blob: Blob, suffix: string) => {
      const extension = blob.type === 'image/webp' ? 'webp' : 'png';
      const storageRef = ref(storage, basePath + '-' + suffix + '.' + extension);
      await uploadBytes(storageRef, blob, {
        cacheControl: 'public,max-age=31536000,immutable',
        contentType: blob.type,
      });
      uploadedPaths.add(storageRef.fullPath);
      return normalizeImageUrl(await getDownloadURL(storageRef));
    };
    // Wait for both uploads even after one fails, so a late-successful sibling
    // cannot escape cleanup. These unique paths have not been saved to any tool.
    const results = await Promise.allSettled([
      upload(images.detail, 'detail'),
      upload(images.thumbnail, 'thumb'),
    ]);
    if (results[0].status === 'rejected' || results[1].status === 'rejected') {
      await cleanup().catch(() => undefined);
      throw (results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason;
    }
    const uploaded = { imageUrl: results[0].value, thumbnailUrl: results[1].value };
    this.pendingUploads.set(uploaded, cleanup);
    return uploaded;
  }

  commitUpload(uploaded: UploadedToolImages | null): void {
    if (uploaded) this.pendingUploads.delete(uploaded);
  }

  async discardUpload(uploaded: UploadedToolImages | null): Promise<void> {
    if (!uploaded) return;
    const cleanup = this.pendingUploads.get(uploaded);
    if (!cleanup) return;
    await cleanup();
    this.pendingUploads.delete(uploaded);
  }
}
