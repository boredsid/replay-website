import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fetchAdmin, showApiError } from '@/lib/api';
import { formatOwners } from '@/lib/catalogue-owners';
import type { CatalogueGameRow } from '@/lib/types';

/**
 * One game.
 *
 * What is editable here follows the one rule the catalogue rests on: a column
 * owned by `sync:library` is shown but not offered, because the next harvest
 * would silently revert it, and a control that quietly undoes itself is worse
 * than one that is not there. A row added by hand has no sync to fight, so all
 * of it is editable.
 */
export default function CatalogueDrawer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const close = () => navigate('/catalogue');

  const [game, setGame] = useState<CatalogueGameRow | null>(null);
  const [aliases, setAliases] = useState<Array<{ folded_title: string; note: string | null }>>([]);
  const [busy, setBusy] = useState(false);

  const [note, setNote] = useState('');
  const [copies, setCopies] = useState('');
  const [ref, setRef] = useState('');
  const [manual, setManual] = useState({ title: '', year: '', min_players: '', max_players: '', min_time: '', max_time: '' });

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await fetchAdmin<{
          game: CatalogueGameRow;
          aliases: Array<{ folded_title: string; note: string | null }>;
        }>(`/api/admin/catalogue/${id}`);
        setGame(data.game);
        setAliases(data.aliases ?? []);
        setCopies(data.game.copies_override === null ? '' : String(data.game.copies_override));
        setManual({
          title: data.game.title,
          year: data.game.year === null ? '' : String(data.game.year),
          min_players: data.game.min_players === null ? '' : String(data.game.min_players),
          max_players: data.game.max_players === null ? '' : String(data.game.max_players),
          min_time: data.game.min_time === null ? '' : String(data.game.min_time),
          max_time: data.game.max_time === null ? '' : String(data.game.max_time),
        });
      } catch (error) {
        showApiError(error);
        close();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patch(body: Record<string, unknown>, success: string) {
    if (!id) return;
    setBusy(true);
    try {
      const data = await fetchAdmin<{ game: CatalogueGameRow }>(`/api/admin/catalogue/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setGame(data.game);
      toast.success(success);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  function takeOff() {
    const reason = note.trim();
    if (!reason) {
      toast.error('Say why, so whoever sees this later knows whether to put it back.');
      return;
    }
    void patch({ shelf_status: 'off_shelf', off_shelf_note: reason }, 'Taken off the shelf');
  }

  async function link() {
    if (!id || !ref.trim()) return;
    setBusy(true);
    try {
      const data = await fetchAdmin<{ game: CatalogueGameRow; merged_into?: string }>(
        `/api/admin/catalogue/${id}/link`,
        { method: 'POST', body: JSON.stringify({ ref: ref.trim() }) },
      );
      setGame(data.game);
      setRef('');
      toast.success(
        data.merged_into
          ? 'Same game — its copies moved onto the card that already existed.'
          : 'Linked. It has its box art now.',
      );
      if (data.merged_into) navigate(`/catalogue/${data.merged_into}`);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusy(false);
    }
  }

  const offShelf = game?.shelf_status === 'off_shelf';

  return (
    <Sheet open onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{game?.title ?? 'Loading…'}</SheetTitle>
          <SheetDescription>
            {game?.source === 'manual'
              ? 'Added by hand. No sync touches this one, so everything here is editable.'
              : 'Box details come from BoardGameGeek and are refreshed by the library sync.'}
          </SheetDescription>
        </SheetHeader>

        {!game ? (
          <div className="p-4 text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-6 p-4">
            <div className="flex gap-4">
              <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                {game.thumb ? (
                  <img src={game.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl font-semibold text-muted-foreground">
                    {game.title.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <dl className="min-w-0 flex-1 space-y-1 text-sm">
                <Line term="Players" value={rangeText(game.min_players, game.max_players)} />
                <Line term="Length" value={rangeText(game.min_time, game.max_time, ' min')} />
                <Line term="Rating" value={game.rating === null ? '—' : String(game.rating)} />
                <Line term="Weight" value={game.weight === null ? '—' : String(game.weight)} />
                <Line
                  term="BoardGameGeek"
                  value={
                    game.bgg_id ? (
                      <a
                        className="underline"
                        href={`https://boardgamegeek.com/boardgame/${game.bgg_id}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {game.bgg_id}
                      </a>
                    ) : (
                      'Not linked'
                    )
                  }
                />
              </dl>
            </div>

            <section className="space-y-2 rounded-md border p-3">
              <h3 className="font-semibold">On the shelf</h3>
              {offShelf ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Taken off {game.off_shelf_at?.slice(0, 10)}
                    {game.off_shelf_by && <> by {game.off_shelf_by}</>}: {game.off_shelf_note}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { void patch({ shelf_status: 'on_shelf' }, 'Back on the shelf'); }}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Put it back
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Taking it off hides it from the library page at the next rebuild, and stops the desk lending it
                    straight away.
                  </p>
                  <label className="block">
                    <span className="mb-1 block text-sm text-muted-foreground">Why</span>
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="The owner is not bringing it"
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={takeOff}
                    className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Take it off the shelf
                  </button>
                </>
              )}
            </section>

            <section className="space-y-2 rounded-md border p-3">
              <h3 className="font-semibold">Copies</h3>
              <p className="text-sm text-muted-foreground">
                {game.copies_actual} {game.copies_actual === 1 ? 'box is' : 'boxes are'} on record.
                {game.copies_override !== null && <> The page shows {game.copies_override}, set here.</>}
              </p>
              <p className="text-sm text-muted-foreground">
                {game.owners?.length
                  ? <>Lent by {formatOwners(game.owners)}.</>
                  : <>No owner recorded{game.source === 'manual' ? ' — it was added by hand, not from a collection' : ''}.</>}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-sm text-muted-foreground">Show this many instead</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={copies}
                    onChange={(event) => setCopies(event.target.value)}
                    placeholder={String(game.copies_actual)}
                    className="w-32 rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void patch(
                      { copies_override: copies.trim() === '' ? null : Number(copies) },
                      copies.trim() === '' ? 'Back to counting the boxes on record' : 'Copy count set',
                    );
                  }}
                  className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave it empty to go back to counting boxes. To show none, take the game off the shelf instead — a
                nought here would advertise an empty space.
              </p>
            </section>

            {!game.bgg_id && (
              <section className="space-y-2 rounded-md border p-3">
                <h3 className="font-semibold">Link it to BoardGameGeek</h3>
                <p className="text-sm text-muted-foreground">
                  Gives it box art and real player counts. If this game is already on the list under a different
                  spelling, its copies move onto that card and this one steps aside.
                </p>
                <input
                  value={ref}
                  onChange={(event) => setRef(event.target.value)}
                  placeholder="Paste a BGG link, or its id"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !ref.trim()}
                  onClick={() => { void link(); }}
                  className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Link
                </button>
              </section>
            )}

            {game.source === 'manual' && (
              <section className="space-y-2 rounded-md border p-3">
                <h3 className="font-semibold">Details</h3>
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
                  disabled={busy}
                  onClick={() => { void patch(manual, 'Saved'); }}
                  className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  Save details
                </button>
              </section>
            )}

            {aliases.length > 0 && (
              <section className="space-y-1 rounded-md border p-3">
                <h3 className="font-semibold">Also known as</h3>
                <p className="text-sm text-muted-foreground">
                  Spellings the club sheet uses that the sync folds onto this game.
                </p>
                <ul className="text-sm text-muted-foreground">
                  {aliases.map((alias) => (
                    <li key={alias.folded_title}>
                      {alias.folded_title}
                      {alias.note && <> — {alias.note}</>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function rangeText(low: number | null, high: number | null, suffix = ''): string {
  if (low === null && high === null) return '—';
  if (low !== null && high !== null && low !== high) return `${low}–${high}${suffix}`;
  return `${high ?? low}${suffix}`;
}

function Line({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
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
