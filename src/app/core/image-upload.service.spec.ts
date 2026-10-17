import { TestBed } from '@angular/core/testing';
import { beforeEach, expect, it, vi } from 'vitest';
import { FirebaseClientService } from './firebase-client.service';
import { FirebaseAuthService } from './firebase-auth.service';
import { ImagePreparationService, ImageUploadService } from './image-upload.service';

const sdk = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), url: vi.fn(), prepare: vi.fn() }));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), ref: (_storage: unknown, fullPath: string) => ({ fullPath }), uploadBytes: sdk.upload, deleteObject: sdk.remove, getDownloadURL: sdk.url }));
beforeEach(() => {
  vi.resetAllMocks();
  sdk.prepare.mockResolvedValue({ detail: new Blob(['detail'], { type: 'image/webp' }), thumbnail: new Blob(['thumb'], { type: 'image/webp' }) });
  sdk.upload.mockResolvedValue(undefined);
  sdk.remove.mockResolvedValue(undefined);
  sdk.url.mockImplementation(async ref => 'https://example.test/' + ref.fullPath);
  TestBed.configureTestingModule({ providers: [ImageUploadService,
    { provide: ImagePreparationService, useValue: { prepare: sdk.prepare } },
    { provide: FirebaseClientService, useValue: { app: {} } },
    { provide: FirebaseAuthService, useValue: { currentUser: () => ({ id: 'owner' }) } },
  ] });
});

it('cleans both unsaved variants, but never deletes a committed or unknown upload', async () => {
  const service = TestBed.inject(ImageUploadService);
  const upload = await service.uploadImage(new File(['image'], 'image.webp'));
  await service.discardUpload(upload);
  expect(sdk.remove).toHaveBeenCalledTimes(2);
  expect(sdk.remove.mock.calls.every(([ref]) => ref.fullPath.startsWith('tools/owner/'))).toBe(true);
  const saved = await service.uploadImage(new File(['image'], 'image.webp'));
  service.commitUpload(saved);
  await service.discardUpload(saved);
  await service.discardUpload({ imageUrl: 'arbitrary', thumbnailUrl: 'arbitrary' });
  expect(sdk.remove).toHaveBeenCalledTimes(2);
});

it('waits for a late successful sibling upload before cleaning a partial failure', async () => {
  let complete!: () => void;
  sdk.upload.mockImplementationOnce(async () => { throw new Error('Upload failed'); })
    .mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const result = TestBed.inject(ImageUploadService).uploadImage(new File(['image'], 'image.webp'));
  await vi.waitFor(() => expect(sdk.upload).toHaveBeenCalledTimes(2));
  expect(sdk.remove).not.toHaveBeenCalled();
  complete();
  await expect(result).rejects.toThrow('Upload failed');
  expect(sdk.remove).toHaveBeenCalledOnce();
  expect(sdk.remove.mock.calls[0][0].fullPath).toContain('-thumb.webp');
});

it('retains a failed cleanup for retry and treats already-missing objects as cleaned', async () => {
  const service = TestBed.inject(ImageUploadService);
  const upload = await service.uploadImage(new File(['image'], 'image.webp'));
  sdk.remove.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(service.discardUpload(upload)).rejects.toThrow('unused uploads');
  sdk.remove.mockRejectedValueOnce(Object.assign(new Error('Missing'), { code: 'storage/object-not-found' }));
  await service.discardUpload(upload);
  await service.discardUpload(upload);
  expect(sdk.remove).toHaveBeenCalledTimes(3);
});
