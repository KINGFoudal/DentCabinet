import { fitWithin, isCompressibleImage, withExtension } from "./clinical";

/**
 * Compresse une image dans le navigateur avant envoi (connexions lentes) :
 * redimensionnée pour tenir dans 1600 px, réencodée en JPEG.
 * Renvoie le fichier d'origine si ce n'est pas une image compressible
 * ou si le résultat n'est pas plus léger.
 */
export async function compressImage(file: File, max = 1600, quality = 0.8): Promise<File> {
  if (!isCompressibleImage(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // format non décodable par le navigateur (ex. HEIC sur certains appareils)
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  // Fond blanc : les zones transparentes d'un PNG ne deviennent pas noires en JPEG.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], withExtension(file.name, ".jpg"), { type: "image/jpeg", lastModified: Date.now() });
}
