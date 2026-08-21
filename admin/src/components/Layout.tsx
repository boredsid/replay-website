import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useWhoAmI } from '@/lib/whoami';
import Sidebar from './Sidebar';
import BottomTabBar from './BottomTabBar';
import TopBar from './TopBar';
import MobileMoreMenu from './MobileMoreMenu';
import { OfflineBanner } from './OfflineBanner';

export default function Layout() {
  const [moreOpen, setMoreOpen] = useState(false);
  const who = useWhoAmI();

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMoreOpen(true)} />
        <OfflineBanner />
        <main className="app-main flex-1 overflow-x-hidden overflow-y-auto bg-muted/30">
          <Outlet />
        </main>
        <BottomTabBar moreOpen={moreOpen} onOpenMore={() => setMoreOpen(true)} />
        <MobileMoreMenu open={moreOpen} onOpenChange={setMoreOpen} email={who?.email} />
      </div>
    </div>
  );
}
