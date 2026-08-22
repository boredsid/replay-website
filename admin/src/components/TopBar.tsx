import { useWhoAmI } from '@/lib/whoami';
import RebuildSiteButton from './RebuildSiteButton';

interface Props {
  onOpenMenu: () => void;
}

export default function TopBar({ onOpenMenu }: Props) {
  const who = useWhoAmI();
  const email = who?.email ?? null;
  const initials = email ? email.slice(0, 1).toUpperCase() : '?';

  return (
    // Navy on phones so the strip iOS draws its status bar over is flat brand
    // colour with nothing for its edge treatment to smear. Desktop keeps the
    // light bar: its children assume a light background and it has no status bar.
    <header className="app-topbar flex shrink-0 items-center gap-2 border-b bg-secondary px-4 text-secondary-foreground md:bg-background md:px-6 md:text-foreground">
      <div className="flex items-center gap-2 min-w-0 md:hidden">
        <img src="/replay-icon.png" alt="" className="h-6 w-6" />
        <span className="font-heading font-semibold">Admin</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3 text-sm min-w-0">
        <RebuildSiteButton className="hidden md:inline-flex" />
        <div className="hidden md:flex items-center gap-2">
          {email && (
            <span className="text-muted-foreground truncate max-w-[180px]">{email}</span>
          )}
          <a href="/cdn-cgi/access/logout" className="hover:underline shrink-0">
            Sign out
          </a>
        </div>
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground md:hidden"
          aria-label={email ? `Open menu for ${email}` : 'Open account menu'}
          title={email || ''}
        >
          {initials}
        </button>
      </div>
    </header>
  );
}
