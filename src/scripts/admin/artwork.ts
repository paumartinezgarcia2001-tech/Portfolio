/**
 * Carátula de los mixes (D64): el navegador la recorta cuadrada desde el
 * centro, la deja en 1000 × 1000 px (o menos, si es más pequeña) y la guarda
 * como JPEG, sin los metadatos del original (EXIF, ubicación…). Es lo que
 * hace `npm run media:mix`, y sale en la pantalla de bloqueo del móvil.
 */
import { MIX_ENCODING } from '../../config/admin';

export interface ConvertedArtwork {
  blob: Blob;
  size: number;
}

export async function convertArtwork(file: File): Promise<ConvertedArtwork> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('No se puede leer la imagen: usa JPG, PNG o WebP.');
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (side < 1) throw new Error('La imagen está vacía.');
    const size = Math.min(MIX_ENCODING.artworkSize, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no puede preparar la imagen.');
    context.fillStyle = '#000';
    context.fillRect(0, 0, size, size);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', MIX_ENCODING.artworkQuality));
    if (!blob) throw new Error('El navegador no puede guardar la imagen.');
    return { blob, size };
  } finally {
    bitmap.close();
  }
}
