import { MoreHorizontal } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { mobileMoreFor, mobilePrimaryFor } from './nav';
import { useWhoAmI } from '@/lib/whoami';

interface Props {
  onOpenMore: () => void;
  moreOpen: boolean;
}

export default function BottomTabBar({ onOpenMore, moreOpen }: Props) {
  const { pathname } = useLocation();
  const who = useWhoAmI();
  const roles = who?.roles ?? [];
  const primary = mobilePrimaryFor(roles);
  const moreActive = mobileMoreFor(roles).some((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  );

  return (
    <nav
      className="app-bottom-bar fixed inset-x-0 bottom-0 z-40 flex border-t bg-background md:hidden"
      aria-label="Primary"
    >
      {primary.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
          aria-label={item.label}
        >
          <item.icon className="h-5 w-5" />
          <span>{item.mobileLabel}</span>
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onOpenMore}
        className={cn(
          'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs',
          moreActive ? 'text-primary' : 'text-muted-foreground',
        )}
        aria-label="More"
        aria-expanded={moreOpen}
      >
        <MoreHorizontal className="h-5 w-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
