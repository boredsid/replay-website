import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './PhotoGallery.css';
import { canNativeShare, canShareUrl, copyLink, sharePhotoFile, shareUrlLink } from '../lib/share';
import {
  countLabel,
  flattenSections,
  galleryApiUrl,
  photoLink,
  shareableImageUrl,
  type GalleryBody,
  type GalleryPhoto,
} from '../lib/gallery';

/**
 * An edition's photo album, on replaycon.in: a grid, a lightbox, and download,
 * share and copy-link on every photo. Modelled on bgc-website's PhotoAlbum.
 *
 * The photos are read when the page is opened, from the Worker, so new photos
 * in the album appear without a rebuild. Whatever the Worker cannot read —
 * Google changed its page, or a Drive album without the Drive key — degrades to
 * a button that opens the album where it is kept.
 *
 * `?photo=<id>` opens that photo, so a copied link lands on the picture.
 */
export interface PhotoGalleryProps {
  slug: string;
  /** "REPLAY 3E" */
  editionLabel: string;
  albumUrl: string;
  /** "Google Photos" or "Google Drive" */
  service: string;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; body: GalleryBody };

export default function PhotoGallery({ slug, editionLabel, albumUrl, service }: PhotoGalleryProps) {
  const workerUrl = import.meta.env.PUBLIC_WORKER_URL ?? '';
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [open, setOpenIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareable, setShareable] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  // The share sheet exists only in some browsers, and only in the browser.
  useEffect(() => setShareable(canNativeShare() || canShareUrl()), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(galleryApiUrl(workerUrl, slug));
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as GalleryBody;
        if (!cancelled) setLoad({ status: 'ready', body });
      } catch {
        if (!cancelled) setLoad({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, workerUrl]);

  const body = load.status === 'ready' ? load.body : null;
  const photos = useMemo(() => (body ? flattenSections(body.sections) : []), [body]);
  const credit = useMemo(() => {
    const byId = new Map<string, string>();
    for (const section of body?.sections ?? []) {
      if (section.title) for (const photo of section.photos) byId.set(photo.id, section.title);
    }
    return byId;
  }, [body]);

  const setOpen = useCallback(
    (index: number | null) => {
      setOpenIndex(index);
      setNotice(null);
      const url = new URL(window.location.href);
      if (index === null) url.searchParams.delete('photo');
      else url.searchParams.set('photo', photos[index].id);
      window.history.replaceState(null, '', url);
    },
    [photos],
  );

  // A shared link opens straight onto its photo.
  useEffect(() => {
    if (!photos.length) return;
    const id = new URLSearchParams(window.location.search).get('photo');
    const index = id ? photos.findIndex((p) => p.id === id) : -1;
    if (index >= 0) setOpenIndex(index);
  }, [photos]);

  const step = useCallback(
    (delta: number) => {
      if (open === null || photos.length === 0) return;
      setOpen((open + delta + photos.length) % photos.length);
    },
    [open, photos.length, setOpen],
  );

  const close = useCallback(() => {
    setOpen(null);
    returnFocus.current?.focus();
  }, [setOpen]);

  // Keys, scroll lock and focus while the lightbox is up.
  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = overflow;
    };
  }, [open, close, step]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 2500);
  }

  async function copy(photo: GalleryPhoto) {
    flash((await copyLink(photoLink(window.location.origin, slug, photo.id))) ? 'Link copied' : 'Could not copy the link');
  }

  async function share(photo: GalleryPhoto) {
    const link = photoLink(window.location.origin, slug, photo.id);
    const text = `${editionLabel} · replaycon.in`;
    // The picture itself where the browser can share a file; otherwise the link
    // to it; otherwise the link on the clipboard. Each is tried once.
    if (photo.kind === 'image' && body && (await sharePhotoFile(photo.name, shareableImageUrl(workerUrl, body.source, photo.id), text))) return;
    if (await shareUrlLink(link, text)) return;
    await copy(photo);
  }

  if (load.status === 'loading') {
    return (
      <div className="gallery" aria-busy="true">
        <p className="gallery__summary">Loading the album…</p>
        <div className="gallery__grid">
          {Array.from({ length: 12 }, (_, i) => <div key={i} className="gallery__tile gallery__tile--skeleton" />)}
        </div>
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="gallery gallery__fallback">
        <p>These photos can't be shown here right now. They're all in the album.</p>
        <a className="btn btn-black" href={albumUrl} target="_blank" rel="noopener noreferrer">
          Open the album on {service} <span aria-hidden="true">↗</span>
        </a>
      </div>
    );
  }

  const current = open !== null ? photos[open] : null;
  let index = 0;

  return (
    <div className="gallery">
      <p className="gallery__summary">
        {photos.length ? countLabel(photos) : 'No photos in this album yet'}
        <span aria-hidden="true"> · </span>
        <a href={albumUrl} target="_blank" rel="noopener noreferrer">Open the album on {service} ↗</a>
      </p>

      {load.body.sections.map((section) => (
        <section className="gallery__section" key={section.title ?? '_'} aria-label={section.title ? `Photos by ${section.title}` : 'Photos'}>
          {section.title && (
            <h2 className="gallery__section-title">
              By {section.title} <span>{section.photos.length}</span>
            </h2>
          )}
          <div className="gallery__grid">
            {section.photos.map((photo) => {
              const at = index++;
              return (
                <button
                  key={photo.id}
                  type="button"
                  className="gallery__tile"
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    setOpen(at);
                  }}
                  aria-label={`${photo.kind === 'video' ? 'Video' : 'Photo'} ${at + 1} of ${photos.length}${section.title ? `, by ${section.title}` : ''}`}
                >
                  <img src={photo.thumbUrl} alt="" loading="lazy" decoding="async" />
                  {photo.kind === 'video' && <span className="gallery__play" aria-hidden="true">▶</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {!load.body.complete && (
        <p className="gallery__more">
          Showing the first {photos.length}.{' '}
          <a href={albumUrl} target="_blank" rel="noopener noreferrer">See the whole album on {service} ↗</a>
        </p>
      )}

      {current && open !== null && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${current.kind === 'video' ? 'Video' : 'Photo'} ${open + 1} of ${photos.length}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="lightbox__top">
            <span className="lightbox__count">
              {open + 1} / {photos.length}
              {credit.get(current.id) && <> · by {credit.get(current.id)}</>}
            </span>
            <button ref={closeButton} type="button" className="lightbox__close" onClick={close} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="lightbox__stage" onClick={(event) => event.target === event.currentTarget && close()}>
            <button type="button" className="lightbox__nav lightbox__nav--prev" onClick={() => step(-1)} aria-label="Previous">
              ‹
            </button>
            {current.kind === 'video' ? (
              <a className="lightbox__video" href={current.viewUrl} target="_blank" rel="noopener noreferrer">
                <img src={current.fullUrl} alt={`Video ${open + 1} from ${editionLabel}`} />
                <span className="gallery__play gallery__play--large" aria-hidden="true">▶</span>
              </a>
            ) : (
              <img className="lightbox__image" src={current.fullUrl} alt={`Photo ${open + 1} from ${editionLabel}`} />
            )}
            <button type="button" className="lightbox__nav lightbox__nav--next" onClick={() => step(1)} aria-label="Next">
              ›
            </button>
          </div>

          <div className="lightbox__actions">
            {current.kind === 'video' && (
              <a className="btn btn-primary" href={current.viewUrl} target="_blank" rel="noopener noreferrer">
                Play on {service} ↗
              </a>
            )}
            {shareable && (
              <button type="button" className={current.kind === 'video' ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => share(current)}>
                Share
              </button>
            )}
            <a className="btn btn-secondary" href={current.downloadUrl} target="_blank" rel="noopener noreferrer" download={current.name}>
              Download
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => copy(current)}>
              Copy link
            </button>
          </div>
          <p className="lightbox__notice" role="status" aria-live="polite">{notice ?? ''}</p>
        </div>
      )}
    </div>
  );
}
