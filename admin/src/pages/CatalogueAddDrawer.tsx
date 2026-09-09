import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { BggPreview, CatalogueGameRow } from '@/lib/types';

/**
 * Adding a game.
 *
 * There is no search box, and that is not an omission. BoardGameGeek's search
 * page answers 403 to anything that is not a browser, so a server cannot look a
 * game up by name — only by id. Asking for a link the person already has open
 * is the honest version of the same step, and it removes the "which of these
 * four games called Scout did you mean" problem at the same time.
 */
export default function CatalogueAddDrawer() {
  const navigate = useNavigate();
  const close = () => navigate('/catalogue');

  const [mode, setMode] = useState<'bgg' | 'manual'>('bgg');
  const [busy, setBusy] = useState(false);
  const [copies, setCopies] = useState('1');

  const [ref, setRef] = useState('');
  const [preview, setPreview] = useState<{ bgg_id: number; detail: BggPreview } | null>(null);
  const [already, setAlready] = useState<{ id: string; title: string; shelf_status: string } | null>(null);

  const [manual, setManual] = useState({ title: '', year: '', min_players: '', max_players: '', min_time: '', max_time: '' });

  async function lookUp() {
    if (!ref.trim()) return;
    setBusy(true);
    setPreview(null);
    setAlready(null);
    try {
      const data = await fetchAdmin<{
        bgg_id: number;
        detail: BggPreview;
        existing: { id: string; title: string; shelf_status: string } | null;
      }>('/api/admin/catalogue/lookup', { method: 'POST', body: JSON.stringify({ ref: ref.trim() }) });
      setPreview({ bgg_id: data.bgg_id, detail: data.detail });
      setAlready(data.existing);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  async function add(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const data = await fetchAdmin<{ game: CatalogueGameRow }>('/api/admin/catalogue', {
        method: 'POST',
        body: JSON.stringify({ ...body, copies: Number(copies) || 1 }),
      });
      toast.success(`${data.game.title} is on the shelf.`);
      navigate(`/catalogue/${data.game.id}`);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Add a game</SheetTitle>
          <SheetDescription>
            It joins the desk straight away, and the library page at the next rebuild.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 p-4">
          <div className="flex gap-2">
            {(['bgg', 'manual'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                aria-pressed={mode === option}
                className={`rounded-full border px-3 py-1 text-sm ${
                  mode === option ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                }`}
              >
                {option === 'bgg' ? 'From BoardGameGeek' : 'Not on BoardGameGeek'}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-sm text-muted-foreground">How many copies are coming</span>
            <input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(event) => setCopies(event.target.value)}
              className="w-32 rounded-md border bg-background px-3 py-2 text-sm"
            />
          </label>

          {mode === 'bgg' ? (
            <section className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm text-muted-foreground">BoardGameGeek link or id</span>
                <input
                  value={ref}
                  onChange={(event) => setRef(event.target.value)}
                  placeholder="https://boardgamegeek.com/boardgame/194655/santorini"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  Open the game on BoardGameGeek and paste the address. Expansions work too.
                </span>
              </label>
              <button
                type="button"
                disabled={busy || !ref.trim()}
                onClick={() => { void lookUp(); }}
                className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Looking…' : 'Look it up'}
              </button>

              {preview && (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex gap-3">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                      {preview.detail.thumb ? (
                        <img src={preview.detail.thumb} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-2xl font-semibold text-muted-foreground">
                          {preview.detail.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold">
                        {preview.detail.name}
                        {preview.detail.year && <span className="ml-1.5 font-normal text-muted-foreground">{preview.detail.year}</span>}
                      </p>
                      <p className="text-muted-foreground">
                        {preview.detail.minPlayers ?? '?'}–{preview.detail.maxPlayers ?? '?'} players ·{' '}
                        {preview.detail.minTime ?? '?'}–{preview.detail.maxTime ?? '?'} min
                      </p>
                      <p className="text-muted-foreground">
                        Rating {preview.detail.rating ?? '—'} · weight {preview.detail.weight ?? '—'}
                      </p>
                    </div>
                  </div>

                  {already ? (
                    <p className="rounded-md bg-amber-100 p-2 text-sm text-amber-950">
                      This game is already on the list as “{already.title}”
                      {already.shelf_status === 'off_shelf' && ', currently off the shelf'}. Open it instead of adding a
                      second card.
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { void add({ mode: 'bgg', ref: String(preview.bgg_id) }); }}
                      className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      Add {preview.detail.name}
                    </button>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section className="space-y-3">
              <p className="text-sm text-muted-foreground">
                For a REPLAY box, a prototype, or a game BoardGameGeek has never listed. It gets a monogram tile instead
                of box art, and no sync will ever overwrite or remove it.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField label="Title" value={manual.title} onChange={(v) => setManual({ ...manual, title: v })} />
                <TextField label="Year" value={manual.year} onChange={(v) => setManual({ ...manual, year: v })} />
                <TextField label="Fewest players" value={manual.min_players} onChange={(v) => setManual({ ...manual, min_players: v })} />
                <TextField label="Most players" value={manual.max_players} onChange={(v) => setManual({ ...manual, max_players: v })} />
                <TextField label="Shortest game (min)" value={manual.min_time} onChange={(v) => setManual({ ...manual, min_time: v })} />
                <TextField label="Longest game (min)" value={manual.max_time} onChange={(v) => setManual({ ...manual, max_time: v })} />
              </div>
              <button
                type="button"
                disabled={busy || !manual.title.trim()}
                onClick={() => { void add({ mode: 'manual', ...manual }); }}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Add it
              </button>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}
