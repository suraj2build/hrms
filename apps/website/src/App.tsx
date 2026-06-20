import React, { useState } from 'react';
import LandingPage from './components/LandingPage';
import PlatformConsole from './components/PlatformConsole';

export default function App() {
  // 'landing' represents public front site, 'console' represents inside live app tour
  const [view, setView] = useState<'landing' | 'console'>('landing');
  const [persona, setPersona] = useState<'admin' | 'employee'>('admin');

  // When VITE_DEMO_URL is set, "Launch Demo" opens the REAL portal Demo tenant
  // (auto-logged-in, with the Admin/ESS RoleSwitcher) instead of the in-browser
  // mock tour. Falls back to the local PlatformConsole tour when unset.
  const DEMO_URL = import.meta.env.VITE_DEMO_URL as string | undefined;

  const handleLaunchConsole = (preferredPersona: 'admin' | 'employee') => {
    if (DEMO_URL) {
      window.location.href = DEMO_URL;
      return;
    }
    setPersona(preferredPersona);
    setView('console');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleExitConsole = () => {
    setView('landing');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <div className="min-h-screen bg-white antialiased text-slate-800 font-sans">
      {view === 'landing' ? (
        <LandingPage onLaunchDemo={handleLaunchConsole} />
      ) : (
        <PlatformConsole initialPersona={persona} onExit={handleExitConsole} />
      )}
    </div>
  );
}
