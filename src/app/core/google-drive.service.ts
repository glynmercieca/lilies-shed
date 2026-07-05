import { Injectable } from '@angular/core';

import { normalizeImageUrl } from './image-url.util';

interface DriveFileListResponse {
  files?: Array<{
    id?: string;
    name?: string;
  }>;
}

@Injectable({ providedIn: 'root' })
export class GoogleDriveService {
  async uploadImages(accessToken: string, files: File[]): Promise<string[]> {
    if (!files.length) {
      return [];
    }

    const parentFolderId = await this.ensureFolderPath(accessToken, ['Lilies', 'Shed']);
    const uploads = files.map((file) => this.uploadImage(accessToken, file, parentFolderId));
    return Promise.all(uploads);
  }

  private async uploadImage(accessToken: string, file: File, parentFolderId: string): Promise<string> {
    const boundary = `boundary_${crypto.randomUUID()}`;
    const metadata = {
      mimeType: file.type || 'application/octet-stream',
      name: file.name || `tool-image-${Date.now()}`,
      parents: [parentFolderId],
    };

    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ]);

    const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    await this.throwIfNotOk(uploadResponse, 'Google Drive image upload failed.');

    const uploadPayload = (await uploadResponse.json()) as { id?: string };
    if (!uploadPayload.id) {
      throw new Error('Google Drive did not return a file id.');
    }

    const permissionResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadPayload.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    });

    await this.throwIfNotOk(permissionResponse, 'Google Drive image sharing setup failed.');

    return normalizeImageUrl(`https://drive.google.com/uc?export=view&id=${uploadPayload.id}`);
  }

  private async ensureFolderPath(accessToken: string, path: string[]): Promise<string> {
    let parentId = 'root';

    for (const folderName of path) {
      parentId = await this.findOrCreateFolder(accessToken, folderName, parentId);
    }

    return parentId;
  }

  private async findOrCreateFolder(accessToken: string, folderName: string, parentId: string): Promise<string> {
    const query =
      `mimeType = 'application/vnd.google-apps.folder' and trashed = false and ` +
      `name = '${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents`;

    const lookupResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    await this.throwIfNotOk(lookupResponse, `Google Drive folder lookup failed for ${folderName}.`);

    const lookupPayload = (await lookupResponse.json()) as DriveFileListResponse;
    const existingFolderId = lookupPayload.files?.[0]?.id;
    if (existingFolderId) {
      return existingFolderId;
    }

    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    });

    await this.throwIfNotOk(createResponse, `Google Drive folder creation failed for ${folderName}.`);

    const createPayload = (await createResponse.json()) as { id?: string };
    if (!createPayload.id) {
      throw new Error(`Google Drive did not return an id for folder ${folderName}.`);
    }

    return createPayload.id;
  }

  private async throwIfNotOk(response: Response, fallbackMessage: string): Promise<void> {
    if (response.ok) {
      return;
    }

    let message = fallbackMessage;

    try {
      const payload = (await response.json()) as {
        error?: {
          message?: string;
        };
      };

      if (payload.error?.message) {
        message = payload.error.message;
      }
    } catch {
      // Keep fallback message when Google does not return JSON.
    }

    throw new Error(message);
  }
}
