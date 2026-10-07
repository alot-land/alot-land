import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TenantBoundary } from './lib/tenant-query';
import { AuthProvider } from './lib/auth';
import { OrgProvider } from './lib/org';
import App from './App';
import { initTheme } from './lib/theme';
import './index.css';

initTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <OrgProvider>
          <TenantBoundary><App /></TenantBoundary>
        </OrgProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
