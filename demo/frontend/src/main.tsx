import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito';
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
  void Promise.all([import('./store/useSim'), import('./pitch/usePitch'), import('./pitch/script'), import('./components/MapView')]).then(([a, b, c, d]) => {
    (window as unknown as Record<string, unknown>).__app = { useSim: a.useSim, usePitch: b.usePitch, SCENES: c.SCENES, camera: d.camera };
  });
}
