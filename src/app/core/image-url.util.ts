export const TOOL_PLACEHOLDER_URL = '/tool-placeholder.svg';

export function normalizeImageUrl(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  const driveFileId = extractGoogleDriveFileId(trimmedValue);
  if (driveFileId) {
    return `https://drive.google.com/uc?export=view&id=${driveFileId}`;
  }

  return trimmedValue;
}

export function normalizeImageUrls(values: string[]): string[] {
  return values.map((value) => normalizeImageUrl(value)).filter(Boolean);
}

export function resolveToolImageUrl(values: string[]): string {
  return normalizeImageUrls(values)[0] ?? TOOL_PLACEHOLDER_URL;
}

export function fallbackImage(event: Event): void {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || image.src.endsWith(TOOL_PLACEHOLDER_URL)) {
    return;
  }

  image.src = TOOL_PLACEHOLDER_URL;
}

export function extractGoogleDriveFileId(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!hostname.endsWith('google.com') && hostname !== 'drive.google.com') {
      return null;
    }

    const searchId = url.searchParams.get('id');
    if (searchId) {
      return searchId;
    }

    const pathSegments = url.pathname.split('/').filter(Boolean);
    const fileSegmentIndex = pathSegments.indexOf('d');
    if (fileSegmentIndex >= 0) {
      return pathSegments[fileSegmentIndex + 1] ?? null;
    }
  } catch {
    return null;
  }

  return null;
}
