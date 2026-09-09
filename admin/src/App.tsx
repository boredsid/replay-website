import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { landingFor } from '@/components/nav';
import { WhoAmIProvider } from '@/lib/whoami';
import { Toaster } from '@/components/ui/sonner';
import Dashboard from '@/pages/Dashboard';
import Finance from '@/pages/Finance';
import RegistrationsList from '@/pages/RegistrationsList';
import RegistrationDrawer from '@/pages/RegistrationDrawer';
import ManualRegistrationDrawer from '@/pages/ManualRegistrationDrawer';
import Leads from '@/pages/Leads';
import AuditLog from '@/pages/AuditLog';
import Editions from '@/pages/Editions';
import EditionDrawer from '@/pages/EditionDrawer';
import Users from '@/pages/Users';
import UserDrawer from '@/pages/UserDrawer';
import CheckIn from '@/pages/CheckIn';
import Staff from '@/pages/Staff';
import Library from '@/pages/Library';
import Catalogue from '@/pages/Catalogue';
import CatalogueDrawer from '@/pages/CatalogueDrawer';
import CatalogueAddDrawer from '@/pages/CatalogueAddDrawer';
import Programme from '@/pages/Programme';
import Events from '@/pages/Events';
import SessionRoster from '@/pages/SessionRoster';
import ProgrammeDrawer from '@/pages/ProgrammeDrawer';
import Announcements from '@/pages/Announcements';
import AnnouncementDrawer from '@/pages/AnnouncementDrawer';
import Partners from '@/pages/Partners';
import Promos from '@/pages/Promos';
import PromoDrawer from '@/pages/PromoDrawer';
import Sponsors from '@/pages/Sponsors';
import SponsorDrawer from '@/pages/SponsorDrawer';
import PartnerDrawer from '@/pages/PartnerDrawer';
import PartnerInviteDrawer from '@/pages/PartnerInviteDrawer';

export function App() {
  return (
    <>
      <WhoAmIProvider fallback={<div className="p-8">Loading…</div>}>
        {(who) => {
          // The dashboard is not part of the read-only floor, so a role holding
          // only that floor is sent to the first page it can actually open
          // rather than to a 403 it has no way to explain.
          const landing = landingFor(who.roles ?? []);
          return (
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={landing === '/' ? <Dashboard /> : <Navigate to={landing} replace />} />
              <Route path="/finance" element={<Finance />} />
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
              <Route path="/check-in" element={<CheckIn />} />
              <Route path="/library" element={<Library />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/catalogue/new" element={<><Catalogue /><CatalogueAddDrawer /></>} />
              <Route path="/catalogue/:id" element={<><Catalogue /><CatalogueDrawer /></>} />
              <Route path="/staff" element={<Staff />} />
              <Route path="/programme" element={<Programme />} />
              <Route path="/programme/new" element={<><Programme /><ProgrammeDrawer /></>} />
              <Route path="/programme/:id/roster" element={<SessionRoster />} />
              <Route path="/programme/:id" element={<><Programme /><ProgrammeDrawer /></>} />
              <Route path="/events" element={<Events />} />
              <Route path="/announcements" element={<Announcements />} />
              <Route path="/announcements/new" element={<><Announcements /><AnnouncementDrawer /></>} />
              <Route path="/announcements/:id" element={<><Announcements /><AnnouncementDrawer /></>} />
              <Route path="/promos" element={<Promos />} />
              <Route path="/promos/new" element={<><Promos /><PromoDrawer /></>} />
              <Route path="/promos/:id" element={<><Promos /><PromoDrawer /></>} />
              <Route path="/partners" element={<Partners />} />
              <Route path="/partners/new" element={<><Partners /><PartnerDrawer /></>} />
              <Route path="/partners/invite" element={<><Partners /><PartnerInviteDrawer /></>} />
              <Route path="/partners/:id" element={<><Partners /><PartnerDrawer /></>} />
              <Route path="/partner-logos" element={<Sponsors />} />
              <Route path="/partner-logos/new" element={<><Sponsors /><SponsorDrawer /></>} />
              <Route path="/partner-logos/:id" element={<><Sponsors /><SponsorDrawer /></>} />
              <Route path="/users" element={<Users />} />
              <Route path="/users/:phone" element={<><Users /><UserDrawer /></>} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          );
        }}
      </WhoAmIProvider>
      <Toaster />
    </>
  );
}
