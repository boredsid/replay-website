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
import Programme from '@/pages/Programme';
import ProgrammeDrawer from '@/pages/ProgrammeDrawer';
import Announcements from '@/pages/Announcements';
import AnnouncementDrawer from '@/pages/AnnouncementDrawer';
import Partners from '@/pages/Partners';
import Sponsors from '@/pages/Sponsors';
import SponsorDrawer from '@/pages/SponsorDrawer';
import PartnerDrawer from '@/pages/PartnerDrawer';
import PartnerInviteDrawer from '@/pages/PartnerInviteDrawer';

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
              <Route path="/programme" element={<Programme />} />
              <Route path="/programme/new" element={<><Programme /><ProgrammeDrawer /></>} />
              <Route path="/programme/:id" element={<><Programme /><ProgrammeDrawer /></>} />
              <Route path="/announcements" element={<Announcements />} />
              <Route path="/announcements/new" element={<><Announcements /><AnnouncementDrawer /></>} />
              <Route path="/announcements/:id" element={<><Announcements /><AnnouncementDrawer /></>} />
              <Route path="/partners" element={<Partners />} />
              <Route path="/partners/new" element={<><Partners /><PartnerDrawer /></>} />
              <Route path="/partners/invite" element={<><Partners /><PartnerInviteDrawer /></>} />
              <Route path="/partners/:id" element={<><Partners /><PartnerDrawer /></>} />
              <Route path="/sponsors" element={<Sponsors />} />
              <Route path="/sponsors/new" element={<><Sponsors /><SponsorDrawer /></>} />
              <Route path="/sponsors/:id" element={<><Sponsors /><SponsorDrawer /></>} />
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
