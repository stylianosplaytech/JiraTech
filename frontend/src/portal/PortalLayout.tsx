import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, isCustomer, type PortalBranding, type User } from '../api';
import { EmailPreference, Logo } from '../components/Layout';
import NotificationBell from '../components/NotificationBell';
import Avatar from '../components/Avatar';
import { Dropdown } from '../components/ui';
import { LogoutIcon } from '../components/Icons';
import { DEFAULT_ACCENT, PortalLogo } from './Branding';

/** The portal a page belongs to, so the header can take on its look. */
export interface PortalBrand {
  slug: string;
  name: string;
  branding: PortalBranding;
}

const BrandContext = createContext<(brand: PortalBrand | null) => void>(() => undefined);

/** Pages inside one help center call this with its branding (or undefined while loading). */
export function usePortalBrand(brand: PortalBrand | null | undefined) {
  const setBrand = useContext(BrandContext);
  const id = brand ? `${brand.slug}|${brand.name}|${brand.branding.color}|${brand.branding.logo?.length}` : '';
  useEffect(() => {
    if (!brand) return undefined;
    setBrand(brand);
    return () => setBrand(null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A customer with a single help center goes straight to it; otherwise to the list of help centers. */
export function usePortalHome(user?: User) {
  const { data: portals } = useQuery({ queryKey: ['portal-list'], queryFn: api.getMyPortals });
  return isCustomer(user) && portals?.length === 1 ? `/portal/${portals[0].slug}` : '/portal';
}

/** The help center chrome: what customers see instead of the full app. Staff get a way back. */
export default function PortalLayout({ user, children }: { user?: User; children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [brand, setBrand] = useState<PortalBrand | null>(null);
  const home = usePortalHome(user);
  const logout = () => {
    localStorage.removeItem('token');
    queryClient.clear();
    navigate('/login');
  };
  const accent = brand?.branding.color ?? DEFAULT_ACCENT;
  const link = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center px-3 text-sm font-medium ${isActive
      ? 'text-[color:var(--accent)] after:absolute after:left-2 after:right-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-[var(--accent)]'
      : 'text-jira-subtle hover:text-jira-navy'}`;

  return (
    <BrandContext.Provider value={setBrand}>
      <div className="min-h-screen flex flex-col bg-[#FAFBFC]" style={{ '--accent': accent } as React.CSSProperties}>
        <header className="sticky top-0 z-40 bg-white border-b border-jira-border" style={{ borderTop: `3px solid ${accent}` }}>
          <div className="h-14 px-2 sm:px-4 flex items-center gap-1 sm:gap-2 max-w-5xl mx-auto">
            {brand ? (
              <Link to={`/portal/${brand.slug}`} className="flex items-center gap-2 pr-2 min-w-0" aria-label={`${brand.name} home`}>
                <PortalLogo branding={brand.branding} name={brand.name} size={28} />
                <span className="hidden sm:inline font-semibold text-[17px] text-jira-navy tracking-tight truncate max-w-[220px]">{brand.name}</span>
              </Link>
            ) : <Logo to={home} label="Help center" />}
            <nav className="flex items-stretch h-14" aria-label="Help center">
              <NavLink to={home} end className={link}>Home</NavLink>
              <NavLink to="/portal/requests" className={link}>Requests</NavLink>
            </nav>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              {user && !isCustomer(user) && <Link to="/" className="btn btn-subtle hidden sm:inline-flex">Back to JiraTech</Link>}
              <NotificationBell />
              {user && (
                <Dropdown
                  align="right"
                  width="w-64"
                  trigger={({ toggle }) => (
                    <button type="button" onClick={toggle} className="rounded-full p-0.5 hover:ring-2 hover:ring-jira-border" aria-label="Your profile and settings">
                      <Avatar name={user.name} size="md" />
                    </button>
                  )}
                >
                  {() => (
                    <>
                      <div className="flex items-center gap-3 px-3 py-2">
                        <Avatar name={user.name} size="md" />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{user.name}</div>
                          <div className="text-xs text-jira-muted truncate">{user.email}</div>
                        </div>
                      </div>
                      <EmailPreference />
                      <div className="border-t border-jira-border mt-1 pt-1">
                        {isCustomer(user) && home !== '/portal' && <Link to="/portal" className="menu-item">All help centers</Link>}
                        {!isCustomer(user) && <Link to="/" className="menu-item sm:hidden">Back to JiraTech</Link>}
                        <button type="button" className="menu-item" onClick={logout}><LogoutIcon size={14} /> Log out</button>
                      </div>
                    </>
                  )}
                </Dropdown>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 w-full max-w-5xl mx-auto min-w-0 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </BrandContext.Provider>
  );
}
