// src/lib/share.ts
//
// The phone's share sheet, for the photo gallery. Ported from bgc-website
// src/lib/share.ts. Each helper returns true when the share was handled —
// including the person dismissing the sheet — and false when the caller should
// fall back to copying a link.

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
}

export function canShareUrl(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareUrlLink(url: string, text = 'REPLAY'): Promise<boolean> {
  if (!canShareUrl()) return false;
  try {
    await navigator.share({ url, text });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    return false;
  }
}

/**
 * Shares the photo itself, so it lands in WhatsApp or Instagram as a picture
 * rather than a link. `imageUrl` is the Worker's copy of it: Google's image
 * hosts do not let another origin read the bytes, and a file needs them.
 */
export async function sharePhotoFile(name: string, imageUrl: string, text = 'REPLAY'): Promise<boolean> {
  if (!canNativeShare()) return false;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return false;
    const blob = await res.blob();
    const file = new File([blob], name || 'replay-photo.jpg', { type: blob.type || 'image/jpeg' });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], text });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    return false;
  }
}

export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
