import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageDimensions, prepareImage, validateImage } from './image-processing.util';

describe('image preparation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fits landscape and portrait photos without upscaling', () => {
    expect(imageDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(imageDimensions(3000, 4000, 480)).toEqual({ width: 360, height: 480 });
    expect(imageDimensions(100, 60, 480)).toEqual({ width: 100, height: 60 });
  });

  it('rejects unsupported, empty and oversized files', () => {
    expect(() => validateImage(new File(['x'], 'x.svg', { type: 'image/svg+xml' }))).toThrow(
      'JPEG',
    );
    expect(() => validateImage(new File([], 'x.jpg', { type: 'image/jpeg' }))).toThrow('12 MB');
    expect(() => validateImage({ type: 'image/jpeg', size: 13 * 1024 * 1024 } as File)).toThrow(
      '12 MB',
    );
  });

  it('encodes both sizes and releases the preview URL', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = 4000;
        naturalHeight = 3000;
        decode = async () => {};
      },
    );
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
    ) {
      sizes.push([this.width, this.height]);
      callback(new Blob(['encoded'], { type: 'image/webp' }));
    });
    const result = await prepareImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(sizes).toEqual([
      [1600, 1200],
      [480, 360],
    ]);
    expect(result.thumbnail.type).toBe('image/webp');
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
