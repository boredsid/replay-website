import { LogOut, RefreshCw } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import InstallAppButton from './InstallAppButton';
import RebuildSiteButton from './RebuildSiteButton';
import { MOBILE_MORE_NAV } from './nav';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email?: string | null;
}

export default function MobileMoreMenu({ open, onOpenChange, email }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-2 pb-2 pt-4 md:hidden"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <SheetHeader className="px-3 pb-2 pt-0 text-left">
          <SheetTitle>More</SheetTitle>
          {email && <SheetDescription className="break-all">Signed in as {email}</SheetDescription>}
        </SheetHeader>

        <nav className="space-y-1" aria-label="More admin sections">
          {MOBILE_MORE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => onOpenChange(false)}
              className={({ isActive }) => cn(
                'flex min-h-11 items-center gap-3 rounded-md px-3 py-3 text-sm',
                isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="my-2 border-t" />

        <RebuildSiteButton
          onComplete={() => onOpenChange(false)}
          className="flex min-h-11 w-full items-center justify-start gap-3 border-0 px-3 py-3 font-normal"
        >
          <RefreshCw className="h-5 w-5" />
          Rebuild public site
        </RebuildSiteButton>
        <InstallAppButton />
        <a
          href="/cdn-cgi/access/logout"
          className="flex min-h-11 items-center gap-3 rounded-md px-3 py-3 text-sm hover:bg-muted"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </a>
      </SheetContent>
    </Sheet>
  );
}
