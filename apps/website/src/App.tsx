import React, { useState } from 'react';
import LandingPage from './components/LandingPage';
import PlatformConsole from './components/PlatformConsole';

export default function App() {
  // 'landing' represents public front site, 'console' represents inside live app tour
  const [view, setView] = useState<'landing' | 'console'>('landing');
  const [persona, setPersona] = useState<'admin' | 'employee'>('admin');

  const handleLaunchConsole = (preferredPersona: 'admin' | 'employee') => {
    setPersona(preferredPersona);
    setView('console');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleExitConsole = () => {
    setView('landing');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  return (
    <div className="min-h-screen bg-slate-50 antialiased text-slate-800 font-sans">
      {view === 'landing' ? (
        <LandingPage onLaunchDemo={handleLaunchConsole} />
      ) : (
        <PlatformConsole initialPersona={persona} onExit={handleExitConsole} />
      )}
    </div>
  );
}
