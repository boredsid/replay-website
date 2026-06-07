import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { WhoAmIProvider } from '@/lib/whoami';
import { Toaster } from '@/components/ui/sonner';
import Dashboard from '@/pages/Dashboard';
import RegistrationsList from '@/pages/RegistrationsList';
import RegistrationDrawer from '@/pages/RegistrationDrawer';
import ManualRegistrationDrawer from '@/pages/ManualRegistrationDrawer';
import Leads from '@/pages/Leads';
import AuditLog from '@/pages/AuditLog';
import Editions from '@/pages/Editions';
import EditionDrawer from '@/pages/EditionDrawer';
import Users from '@/pages/Users';
import UserDrawer from '@/pages/UserDrawer';

export function App() {
  return (
    <>
      <WhoAmIProvider fallback={<div className="p-8">Loading…</div>}>
        {() => (
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/registrations" element={<RegistrationsList />} />
              <Route
                path="/registrations/new"
                element={<><RegistrationsList /><ManualRegistrationDrawer /></>}
              />
              <Route
                path="/registrations/:id"
                element={<><RegistrationsList /><RegistrationDrawer /></>}
              />
              <Route path="/editions" element={<Editions />} />
              <Route path="/editions/new" element={<><Editions /><EditionDrawer /></>} />
              <Route path="/editions/:id" element={<><Editions /><EditionDrawer /></>} />
              <Route path="/users" element={<Users />} />
              <Route path="/users/:phone" element={<><Users /><UserDrawer /></>} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        )}
      </WhoAmIProvider>
      <Toaster />
    </>
  );
}
