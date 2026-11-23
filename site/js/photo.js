import { kindOfName } from './work.js';

// A photo from the camera of a phone is 3–10 MB; it is shrunk on the phone before it is sent (the long side at most 1600 px,
// JPEG), so the upload is quick and the limits of the server are not met. A file that cannot be opened as a picture goes
// as it is when it is a JPEG or a PNG within the limit, otherwise it is refused (photo_unreadable).

const MAX_SIDE = 1600;
const QUALITY = 0.82;
const MAX_BYTES = 10485760;

// The size after shrinking: the long side is at most `max`, the proportions stay, a smaller picture is not enlarged.
export function fitSize(width, height, max = MAX_SIDE) {
  const longest = Math.max(width, height);
  if (!(longest > max)) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// The name of the shrunk photo: the name without its extension and «.jpg».
export function photoName(name) {
  const text = typeof name === 'string' ? name : '';
  const dot = text.lastIndexOf('.');
  const base = dot > 0 ? text.slice(0, dot) : dot === 0 ? '' : text;
  return (base || 'photo') + '.jpg';
}

// The content of a file or a Blob as base64, without the prefix of the data address.
export function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onload = () => {
      const text = String(reader.result);
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

// The picture of a file: createImageBitmap, or an <img> from a temporary address where the first is missing or refuses.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close && bitmap.close() };
    } catch (error) { /* try the <img> way */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('decode_failed'));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));

// -> { name, data } (base64) for upload; throws Error('photo_unreadable').
export async function preparePhoto(file) {
  let picture = null;
  try {
    picture = await decode(file);
    if (!(picture.width > 0 && picture.height > 0)) throw new Error('empty_picture');
    const size = fitSize(picture.width, picture.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';                                         // a PNG with a clear background must not turn black
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(picture.source, 0, 0, size.width, size.height);
    const blob = await toBlob(canvas);
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('no_blob');
    return { name: photoName(file.name), data: await readAsBase64(blob) };
  } catch (error) {
    const kind = kindOfName(file.name);
    if ((kind === 'jpg' || kind === 'png') && file.size <= MAX_BYTES) {
      try {
        return { name: file.name, data: await readAsBase64(file) };
      } catch (readError) { /* unreadable */ }
    }
    throw new Error('photo_unreadable');
  } finally {
    if (picture) picture.done();
  }
}
