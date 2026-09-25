import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoGallery from './PhotoGallery';
import type { GalleryBody, GalleryPhoto } from '../lib/gallery';

const photo = (id: string, kind: GalleryPhoto['kind'] = 'image'): GalleryPhoto => ({
  id,
  name: `${id}.${kind === 'video' ? 'mp4' : 'jpg'}`,
  kind,
  thumbUrl: `https://lh3.googleusercontent.com/pw/${id}=w480-h480-c`,
  fullUrl: `https://lh3.googleusercontent.com/pw/${id}=w1600-h1600`,
  viewUrl: `https://photos.google.com/share/album/photo/${id}`,
  downloadUrl: `https://lh3.googleusercontent.com/pw/${id}=d`,
});

const DRIVE: GalleryBody = {
  source: 'google_drive',
  albumUrl: 'https://drive.google.com/drive/folders/1nVoh6VwZReJZ4QKkSUl5HONKuFpcxLnK',
  complete: true,
  sections: [
    { title: 'Amrit', photos: [photo('a1'), photo('a2', 'video')] },
    { title: 'The Kyu Co', photos: [photo('k1')] },
  ],
};

const props = { slug: 'replay-2', editionLabel: 'REPLAY 2E', albumUrl: DRIVE.albumUrl, service: 'Google Drive' };

function respond(status: number, body: unknown) {
  vi.mocked(global.fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.stubEnv('PUBLIC_WORKER_URL', 'https://api.replaycon.in');
  vi.spyOn(global, 'fetch');
  window.history.replaceState(null, '', '/photos/replay-2/');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('PhotoGallery', () => {
  it('reads the album from the Worker and shows one section per photographer', async () => {
    respond(200, DRIVE);
    render(<PhotoGallery {...props} />);
    expect(await screen.findByText('2 photos and 1 video')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('https://api.replaycon.in/api/photos/replay-2');
    expect(screen.getByRole('heading', { name: /By Amrit/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /By The Kyu Co/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(Photo|Video) \d of 3/ })).toHaveLength(3);
  });

  it('opens a photo with download, copy link, and credit, and steps across sections with the keys', async () => {
    const user = userEvent.setup();
    respond(200, DRIVE);
    render(<PhotoGallery {...props} />);
    await user.click(await screen.findByRole('button', { name: 'Photo 1 of 3, by Amrit' }));

    const dialog = screen.getByRole('dialog', { name: 'Photo 1 of 3' });
    expect(within(dialog).getByText(/1 \/ 3 · by Amrit/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute('href', 'https://lh3.googleusercontent.com/pw/a1=d');
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(window.location.search).toBe('?photo=a1');

    await user.keyboard('{ArrowRight}');
    const video = screen.getByRole('dialog', { name: 'Video 2 of 3' });
    expect(within(video).getByRole('link', { name: /Play on Google Drive/ })).toHaveAttribute('href', 'https://photos.google.com/share/album/photo/a2');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'Photo 3 of 3' })).toHaveTextContent('by The Kyu Co');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog', { name: 'Photo 1 of 3' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('opens straight onto the photo a shared link names', async () => {
    window.history.replaceState(null, '', '/photos/replay-2/?photo=k1');
    respond(200, DRIVE);
    render(<PhotoGallery {...props} />);
    expect(await screen.findByRole('dialog', { name: 'Photo 3 of 3' })).toBeInTheDocument();
  });

  it('copies a link to the photo on this site', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    respond(200, DRIVE);
    render(<PhotoGallery {...props} />);
    await user.click(await screen.findByRole('button', { name: 'Photo 3 of 3, by The Kyu Co' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/photos/replay-2/?photo=k1`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('falls back to the album where the Worker cannot read it', async () => {
    respond(503, { error: 'drive_not_configured', albumUrl: DRIVE.albumUrl });
    render(<PhotoGallery {...props} />);
    const link = await screen.findByRole('link', { name: /Open the album on Google Drive/ });
    expect(link).toHaveAttribute('href', DRIVE.albumUrl);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when only part of a large album could be read', async () => {
    respond(200, { ...DRIVE, complete: false });
    render(<PhotoGallery {...props} />);
    expect(await screen.findByText(/Showing the first 3\./)).toBeInTheDocument();
  });
});
