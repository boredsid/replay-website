import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { EditionRow, SponsorRow, SponsorTier } from '@/lib/types';

/** Mirrors the bucket's allowed types in the worker and the migration. */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/svg+xml'];
const MAX_BYTES = 2 * 1024 * 1024;
/** The wall renders each logo on a 480px-wide tile and never upscales. */
const TARGET_WIDTH = 480;

type Form = {
  edition_id: string;
  name: string;
  tier: SponsorTier;
  website_url: string;
  display_order: string;
  logo_url: string;
  logo_path: string | null;
};

const EMPTY: Form = {
  edition_id: '',
  name: '',
  tier: 'partner',
  website_url: '',
  display_order: '0',
  logo_url: '',
  logo_path: null,
};

/** Raster artwork narrower than a tile is stretched or letterboxed on the wall. */
async function widthOf(file: File): Promise<number | null> {
  if (file.type === 'image/svg+xml' || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const { width } = bitmap;
    bitmap.close();
    return width;
  } catch {
    return null;
  }
}

export default function SponsorDrawer() {
  const nav = useNavigate();
  const { id } = useParams();
  const [search] = useSearchParams();
  const isNew = !id;
  const [editions, setEditions] = useState<EditionRow[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const objectUrl = useRef('');

  useEffect(() => {
    (async () => {
      try {
        const editionsResponse = await fetchAdmin<{ editions: EditionRow[] }>('/api/admin/editions');
        setEditions(editionsResponse.editions);
        if (isNew) {
          const requested = search.get('edition_id');
          const edition = editionsResponse.editions.find((item) => item.id === requested)
            ?? editionsResponse.editions.find((item) => item.is_current)
            ?? editionsResponse.editions[0];
          setForm((current) => ({ ...current, edition_id: edition?.id ?? '' }));
        } else {
          const response = await fetchAdmin<{ sponsor: SponsorRow }>(`/api/admin/sponsors/${id}`);
          const sponsor = response.sponsor;
          setForm({
            edition_id: sponsor.edition_id,
            name: sponsor.name,
            tier: sponsor.tier,
            website_url: sponsor.website_url ?? '',
            display_order: String(sponsor.display_order),
            logo_url: sponsor.logo_url,
            logo_path: sponsor.logo_path,
          });
          setPreview(sponsor.logo_url);
        }
        setLoaded(true);
      } catch (error) {
        showApiError(error);
        nav('/sponsors');
      }
    })();
  }, [id, isNew, nav, search]);

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function chooseFile(chosen: File | null) {
    if (!chosen) return;
    if (!ACCEPTED_TYPES.includes(chosen.type)) {
      toast.error('Use a PNG, JPEG, WebP, AVIF or SVG file.');
      return;
    }
    if (chosen.size > MAX_BYTES) {
      toast.error('Logo files must be 2 MB or smaller.');
      return;
    }
    const width = await widthOf(chosen);
    if (width !== null && width < TARGET_WIDTH) {
      toast.warning(`That artwork is ${width}px wide. The wall never upscales, so it will look smaller than the rest.`);
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(chosen);
    setFile(chosen);
    setPreview(objectUrl.current);
    if (!form.name.trim()) set('name', chosen.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
  }

  async function save() {
    if (!form.edition_id || !form.name.trim()) {
      toast.error('Edition and name are required.');
      return;
    }
    if (!file && !form.logo_url) {
      toast.error('Upload a logo first.');
      return;
    }
    const order = Number(form.display_order);
    if (!Number.isInteger(order) || order < 0) {
      toast.error('Order must be a whole number, 0 or higher.');
      return;
    }

    setBusy(true);
    try {
      let { logo_url: logoUrl, logo_path: logoPath } = form;
      if (file) {
        const uploaded = await fetchAdmin<{ logo_url: string; logo_path: string }>(
          `/api/admin/sponsors/logo?edition_id=${encodeURIComponent(form.edition_id)}`,
          { method: 'POST', headers: { 'Content-Type': file.type }, body: file },
        );
        logoUrl = uploaded.logo_url;
        logoPath = uploaded.logo_path;
      }

      const payload = {
        edition_id: form.edition_id,
        name: form.name.trim(),
        tier: form.tier,
        website_url: form.website_url.trim() || null,
        display_order: order,
        logo_url: logoUrl,
        logo_path: logoPath,
      };
      if (isNew) await fetchAdmin('/api/admin/sponsors', { method: 'POST', body: JSON.stringify(payload) });
      else await fetchAdmin(`/api/admin/sponsors/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success(isNew ? 'Sponsor added — rebuild the site to publish it' : 'Sponsor saved — rebuild the site to publish it');
      nav('/sponsors');
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetchAdmin(`/api/admin/sponsors/${id}`, { method: 'DELETE' });
      toast.success('Sponsor removed — rebuild the site to publish the change');
      nav('/sponsors');
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (!loaded) return null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) nav('/sponsors'); }}>
      <SheetContent className="w-full overflow-y-auto p-6 sm:max-w-lg">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>{isNew ? 'New sponsor' : 'Edit sponsor'}</SheetTitle>
          <SheetDescription>
            Artwork is trimmed and re-seated on a shared tile during the site build, so a logo on a white square and
            one on transparency end up the same optical size. Supply it at least {TARGET_WIDTH}px wide.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <Field label="Edition">
            <select aria-label="Edition" value={form.edition_id} onChange={(event) => set('edition_id', event.target.value)} className="w-full rounded-md border px-3 py-2">
              {editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.slug} · {edition.start_date}</option>)}
            </select>
          </Field>

          <Field label="Logo">
            <div className="space-y-2">
              <div className="flex h-32 items-center justify-center rounded-md border bg-white p-4">
                {preview
                  ? <img src={preview} alt="Logo preview" className="max-h-full max-w-full object-contain" />
                  : <span className="text-sm text-muted-foreground">No logo chosen</span>}
              </div>
              <input
                aria-label="Logo"
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                onChange={(event) => { void chooseFile(event.target.files?.[0] ?? null); }}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, AVIF or SVG, up to 2 MB.</p>
            </div>
          </Field>

          <Field label="Name">
            <input aria-label="Name" value={form.name} maxLength={160} onChange={(event) => set('name', event.target.value)} className="w-full rounded-md border px-3 py-2" />
          </Field>

          <Field label="Links to (optional)">
            <input aria-label="Links to (optional)" type="url" inputMode="url" placeholder="https://example.com" value={form.website_url} onChange={(event) => set('website_url', event.target.value)} className="w-full rounded-md border px-3 py-2" />
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            With a link the logo opens it in a new tab. Leave this empty and the logo simply sits on the wall.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tier">
              <select aria-label="Tier" value={form.tier} onChange={(event) => set('tier', event.target.value as SponsorTier)} className="w-full rounded-md border px-3 py-2">
                <option value="title">Title sponsor</option>
                <option value="gold">Gold sponsor</option>
                <option value="silver">Silver sponsor</option>
                <option value="partner">Partner</option>
              </select>
            </Field>
            <Field label="Order within tier">
              <input aria-label="Order within tier" type="number" min={0} step={1} value={form.display_order} onChange={(event) => set('display_order', event.target.value)} className="w-full rounded-md border px-3 py-2" />
            </Field>
          </div>

          <button disabled={busy} onClick={save} className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50">
            {busy ? 'Saving…' : isNew ? 'Add sponsor' : 'Save sponsor'}
          </button>

          {!isNew && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              className="w-full rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50"
            >
              Remove from the wall
            </button>
          )}
        </div>

        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {form.name}?</DialogTitle>
              <DialogDescription>
                This deletes the sponsor and its uploaded artwork. The wall drops the logo at the next site rebuild.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button type="button" onClick={() => setConfirmDelete(false)} className="w-full rounded-md border px-3 py-2 text-sm sm:w-auto">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { void remove(); }}
                className="w-full rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
              >
                {busy ? 'Removing…' : 'Remove sponsor'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span className="mb-1 block text-sm text-muted-foreground">{label}</span>{children}</label>;
}
