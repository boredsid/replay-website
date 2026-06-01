import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomTabBar from './BottomTabBar';
import TopBar from './TopBar';

export default function Layout() {
  return (
    <div className="flex h-full">
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main
          className="flex-1 overflow-auto bg-muted/30 p-4 md:p-6 pb-20 md:pb-6"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        >
          <Outlet />
        </main>
        <BottomTabBar />
      </div>
    </div>
  );
}
