import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HubApp from './App';
import './app.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <HubApp />
  </StrictMode>,
);
