import { createBrowserRouter, Navigate } from 'react-router';
import App from './App';

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

export const router = createBrowserRouter([
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
]);
