/** Wider than this is more than any email needs (the logo is drawn about 48 px tall). */
const MAX_WIDTH = 600;
const MAX_HEIGHT = 300;
/** What the server accepts, as a data: URI. */
const MAX_DATA_URI = 400_000;
const KEPT = ['image/png', 'image/jpeg', 'image/gif'];

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(new Error('Could not read the image'));
  reader.readAsDataURL(blob);
});

const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('That file is not an image this browser can open'));
  img.src = src;
});

/**
 * An uploaded logo as a data: URI that every mail client can show: PNG, JPEG and GIF of a sensible size are kept
 * as they are; anything larger, or another format (WebP, SVG), is redrawn as a PNG at most 600×300.
 */
export async function readLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
  const original = await readAsDataUrl(file);
  const img = await load(original);
  const small = img.naturalWidth <= MAX_WIDTH && img.naturalHeight <= MAX_HEIGHT;
  if (KEPT.includes(file.type) && small && original.length <= MAX_DATA_URI) return original;

  const scale = Math.min(1, MAX_WIDTH / (img.naturalWidth || MAX_WIDTH), MAX_HEIGHT / (img.naturalHeight || MAX_HEIGHT));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.naturalWidth || MAX_WIDTH) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || MAX_HEIGHT) * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  let out = canvas.toDataURL('image/png');
  // A photo-like logo can stay large as PNG; JPEG on white is far smaller.
  if (out.length > MAX_DATA_URI) {
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL('image/jpeg', 0.9);
  }
  if (out.length > MAX_DATA_URI) throw new Error('The logo is too large even when shrunk: try a simpler image');
  return out;
}
