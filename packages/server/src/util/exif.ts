import exifr from 'exifr';

export interface ExifSummary {
  capturedAt: Date | null;
  cameraModel: string | null;
  raw: Record<string, unknown> | null;
}

export async function readExif(path: string): Promise<ExifSummary> {
  try {
    const data = (await exifr.parse(path, { tiff: true, exif: true, gps: true })) as
      | (Record<string, unknown> & { DateTimeOriginal?: Date; Model?: string })
      | undefined;
    if (!data) return { capturedAt: null, cameraModel: null, raw: null };
    return {
      capturedAt: data.DateTimeOriginal instanceof Date ? data.DateTimeOriginal : null,
      cameraModel: typeof data.Model === 'string' ? data.Model : null,
      raw: data,
    };
  } catch {
    return { capturedAt: null, cameraModel: null, raw: null };
  }
}

/** Extract a trailing numeric run from a filename (IMG_4521.jpg → 4521). */
export function filenameNumericSuffix(filename: string): number | null {
  const base = filename.replace(/\.[^.]+$/, '');
  const match = base.match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
