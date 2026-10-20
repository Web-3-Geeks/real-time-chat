export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 1600;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image.'));
    };
    img.src = url;
  });

/**
 * Validates and shrinks a picked image before upload: anything larger than
 * 1600px is scaled down and re-encoded as JPEG, which keeps phone photos
 * (often 3-8MB) well under the 5MB server limit. GIFs are sent untouched so
 * they stay animated. Resolves to a Blob, or rejects with a user-facing message.
 */
export async function prepareImage(file) {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error('Only JPEG, PNG, WebP or GIF images can be sent.');
  }

  if (file.type === 'image/gif') {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('GIF is too large (max 5MB).');
    return file;
  }

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));

  // Small enough already — send as-is to keep PNG transparency/quality.
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha: paint white first so transparent PNGs don't turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not process this image.');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Image is too large (max 5MB).');
  return blob;
}
