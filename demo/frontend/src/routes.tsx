import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import TourOverlay from './tour/TourOverlay';
import App from './App';
import CataloguePage from './components/CataloguePage';

/** The focusable panels of the control room. URLs double as deep links. */
export type PanelId = 'overview' | 'solar' | 'batteries' | 'impact' | 'dashboard' | 'insights';

export const PANEL_PATHS: Record<Exclude<PanelId, 'overview'>, string> = {
  solar: '/solar',
  batteries: '/batteries',
  impact: '/impact',
  dashboard: '/dashboard',
  insights: '/insights',
};

export function panelFromPath(pathname: string): PanelId {
  switch (pathname) {
    case '/solar':
      return 'solar';
    case '/batteries':
      return 'batteries';
    case '/impact':
      return 'impact';
    case '/insights':
      return 'insights';
    case '/dashboard':
      return 'dashboard';
    default:
      return 'overview';
  }
}

/** root layout: the guided tour lives above both the map and the catalogue page */
function Root() {
  return (
    <>
      <Outlet />
      <TourOverlay />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
  { path: '/catalogue', element: <CataloguePage /> },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: null },
      { path: 'solar', element: null },
      { path: 'batteries', element: null },
      { path: 'impact', element: null },
      { path: 'dashboard', element: null },
      { path: 'insights', element: null },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  ],
  },
]);
