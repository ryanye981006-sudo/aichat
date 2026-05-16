import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './providers/ThemeProvider';
import App from './App';
import './styles/global.css';

// 诊断 electronAPI 可用性
const ea = (window as any).electronAPI;
console.log('[main] electronAPI:', ea ? Object.keys(ea).filter(k => typeof ea[k] === 'function' || k === 'isElectron') : 'UNDEFINED');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
