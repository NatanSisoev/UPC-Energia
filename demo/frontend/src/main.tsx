import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { RouterProvider } from 'react-router';
import { router } from './routes';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// dev-only handles for browser debugging / scripted verification
if (import.meta.env.DEV) {
  void Promise.all([import('./store/useSim'), import('./components/MapView'), import('./lib/assistant')]).then(([a, d, e]) => {
    (window as unknown as Record<string, unknown>).__app = { useSim: a.useSim, camera: d.camera, ask: e.ask };
  });
}
