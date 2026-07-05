import { describe, expect, it } from 'vitest';

import { normalizeImageUrl, normalizeImageUrls, resolveToolImageUrl, TOOL_PLACEHOLDER_URL } from './image-url.util';

describe('image URL utilities', () => {
  it('keeps direct image URLs unchanged', () => {
    expect(normalizeImageUrl('https://example.com/tool.jpg')).toBe('https://example.com/tool.jpg');
  });

  it('converts Google Drive share links to direct image URLs', () => {
    expect(normalizeImageUrl('https://drive.google.com/file/d/abc123/view?usp=sharing')).toBe(
      'https://drive.google.com/uc?export=view&id=abc123',
    );
  });

  it('converts Google Drive open links to direct image URLs', () => {
    expect(normalizeImageUrl('https://drive.google.com/open?id=xyz987')).toBe(
      'https://drive.google.com/uc?export=view&id=xyz987',
    );
  });

  it('normalizes lists and drops empty entries', () => {
    expect(
      normalizeImageUrls([' https://drive.google.com/file/d/abc123/view ', '', 'https://example.com/kit.png']),
    ).toEqual([
      'https://drive.google.com/uc?export=view&id=abc123',
      'https://example.com/kit.png',
    ]);
  });

  it('uses the placeholder when there are no usable image URLs', () => {
    expect(resolveToolImageUrl(['', '   '])).toBe(TOOL_PLACEHOLDER_URL);
  });

  it('uses the first usable normalized image URL when present', () => {
    expect(resolveToolImageUrl(['', 'https://drive.google.com/open?id=xyz987'])).toBe(
      'https://drive.google.com/uc?export=view&id=xyz987',
    );
  });
});
