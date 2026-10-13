export const MAX_IMAGE_INPUT_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImage(file: File): void {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP image.');
  }
  if (!file.size || file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error('Images must be 12 MB or smaller.');
  }
}

export function imageDimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareImage(file: File): Promise<{ detail: Blob; thumbnail: Blob }> {
  validateImage(file);
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const encode = async (maxEdge: number, quality: number): Promise<Blob> => {
      const canvas = document.createElement('canvas');
      const size = imageDimensions(image.naturalWidth, image.naturalHeight, maxEdge);
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare images.');
      context.drawImage(image, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
      if (!blob || blob.size > MAX_IMAGE_UPLOAD_BYTES) {
        throw new Error('Unable to compress this image below 2 MB. Choose a smaller image.');
      }
      return blob;
    };
    return { detail: await encode(1600, 0.82), thumbnail: await encode(480, 0.75) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
