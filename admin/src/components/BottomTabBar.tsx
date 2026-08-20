import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NAV } from './nav';

export default function BottomTabBar() {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t flex overflow-x-auto"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      {NAV.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              'flex-none min-w-[4.75rem] flex flex-col items-center justify-center gap-0.5 py-2 min-h-11 text-xs',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
          aria-label={t.label}
        >
          <t.icon className="h-5 w-5" />
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
