import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NAV } from './nav';

interface Props {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: Props) {
  return (
    <aside className="app-sidebar flex h-full w-56 shrink-0 flex-col border-r bg-background">
      <div className="p-4 flex items-center gap-2">
        <img src="/replay-icon.png" alt="" className="h-7 w-7" />
        <span className="font-heading font-semibold text-lg">Admin</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
                isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
