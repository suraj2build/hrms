import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  Clock,
  CreditCard,
  Users,
  Target,
  Briefcase,
  ShieldCheck,
  Calculator,
  ChevronRight,
  ArrowRight,
  BarChart3,
  Smartphone,
  Quote,
  Zap,
  CheckCircle2,
  Lock,
  Building,
  Check
} from 'lucide-react';

interface LandingPageProps {
  onLaunchDemo: (role: 'admin' | 'employee') => void;
}

export default function LandingPage({ onLaunchDemo }: LandingPageProps) {
  const [employeeCount, setEmployeeCount] = useState<number>(100);
  const [selectedPlan, setSelectedPlan] = useState<'foundation' | 'strength' | 'growth'>('strength');
  const [includeAts, setIncludeAts] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<'payroll' | 'attendance' | 'performance' | 'talent'>('payroll');

  // Calculates the monthly cost structure dynamically based on CognixHR's Indian Rupee pricing structure
  const calculateCost = () => {
    const baseCap = 100;
    let baseRate = 9999;
    let extraUserRate = 90;

    if (selectedPlan === 'foundation') {
      baseRate = 6999;
      extraUserRate = 60;
    } else if (selectedPlan === 'strength') {
      baseRate = 9999;
      extraUserRate = 90;
    } else if (selectedPlan === 'growth') {
      baseRate = 13999;
      extraUserRate = 130;
    }

    const extraEmployees = Math.max(0, employeeCount - baseCap);
    const extraCost = extraEmployees * extraUserRate;
    
    let flatAtsCost = 0;
    if (includeAts) {
      flatAtsCost = 3999;
    }

    const total = baseRate + extraCost + flatAtsCost;
    return {
      base: baseRate,
      extraCount: extraEmployees,
      perExtraUser: extraUserRate,
      flat: flatAtsCost,
      total: total
    };
  };

  const costResult = calculateCost();

  const tabsContent = {
    payroll: {
      title: "Consent-Free Automated Payroll",
      subtitle: "Say goodbye to spreadsheets, formulas, and manual compliance calculations.",
      points: [
        "1-Click payroll settlement for full-time & remote contract squads.",
        "Integrated statutory compliance (PF, Professional Tax, ESI, and TDS automated filings).",
        "Empower workers with self-service tax decs, investments, and instant salary slips.",
        "Direct API tie-ups with leading banks for near-instant online salary dispersing."
      ],
      badge: "Compliance Champion",
      accentColor: "from-amber-500 to-orange-600",
      stats: { primary: "100%", label: "Accuracy Assurance" }
    },
    attendance: {
      title: "Real-time Attendance and Geofenced Tracking",
      subtitle: "Robust clocking limits designed to embrace transparent hybrid work culture.",
      points: [
        "Interactive Geofencing and Wi-Fi SSID lockouts to prevent remote proxy punching.",
        "Custom shift planning, overtime approval loops, and automated night-shift allowance trackers.",
        "Intuitive visual leaves engine with automatic ledger deductions (Casual, Medical, Privilege).",
        "Biometric hardware APIs for physical office entry synchronization."
      ],
      badge: "No More Buddy Punching",
      accentColor: "from-cyan-500 to-blue-600",
      stats: { primary: "< 2s", label: "Clock-In Processing" }
    },
    performance: {
      title: "Performance & OKR Goal Enablers",
      subtitle: "Steer focus towards targets instead of endless appraisal checklists.",
      points: [
        "Company, department, and individual key result cascading (OKRs).",
        "Transparent 360-degree peer-review workflows and self-assessments.",
        "Continuous feedback corner with public shoutouts and leadership kudos badges.",
        "Flexible review timelines: Quarterly, Half-Yearly, or Continuous."
      ],
      badge: "Culture & Alignment",
      accentColor: "from-purple-500 to-indigo-600",
      stats: { primary: "2.4x", label: "Better Goal Alignment" }
    },
    talent: {
      title: "Intuitive Applicant Tracking System (ATS)",
      subtitle: "Acquire standout talent with direct interview workflows and analytics.",
      points: [
        "Custom career portals with structural application parsing.",
        "Visual Kanban stages of recruitment from application screening to rolling offers.",
        "Evaluator boards with collaborative resume scoring and internal feedback logs.",
        "Email automation hooks for bulk interview schedules and offer letter builders."
      ],
      badge: "Talent Booster",
      accentColor: "from-green-500 to-emerald-600",
      stats: { primary: "18 Days", label: "Avg. Reduction in Time-To-Hire" }
    }
  };

  return (
    <div id="landing-container" className="bg-slate-50 text-slate-800 min-h-screen font-sans selection:bg-indigo-500 selection:text-white">
      {/* Dynamic Header */}
      <nav id="navbar" className="sticky top-0 z-50 backdrop-blur-md bg-white/95 border-b border-slate-200 shadow-[0_2px_15px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.8)] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 via-blue-700 to-blue-500 flex items-center justify-center text-white shadow-md shadow-blue-500/10">
                <Zap className="w-5 h-5 fill-white text-white" />
              </div>
              <div>
                <span className="font-sans font-extrabold text-xl tracking-tight text-slate-900 block leading-tight">Cognix<span className="text-teal-500">HR</span></span>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-8">
              <a href="#features-section" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors">Platform</a>
              <a href="#features-section" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors inline-flex items-center gap-1">AI Intelligence <span className="bg-blue-100 text-blue-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">New</span></a>
              <a href="#security-section" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors">Compliance</a>
              <a href="#calculator-section" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors">Pricing</a>
              <a href="#why-section" className="text-sm font-semibold text-slate-600 hover:text-blue-600 transition-colors">Customers</a>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
               id="cta-employee-login"
               onClick={() => onLaunchDemo('employee')}
               className="text-sm font-semibold text-slate-700 hover:text-blue-600 px-3 py-2 transition-all cursor-pointer"
            >
              Sign in
            </button>
            <button 
              id="cta-admin-login"
              onClick={() => onLaunchDemo('admin')}
              className="text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-[#07216f] hover:from-blue-700 hover:to-[#051853] shadow-[0_4px_14px_rgba(29,78,216,0.30),inset_0_1px_0_rgba(255,255,255,0.25)] hover:shadow-[0_6px_20px_rgba(29,78,216,0.40),inset_0_1px_0_rgba(255,255,255,0.35)] px-5 py-2.5 rounded-full transition-all flex items-center gap-1.5 hover:scale-[1.02] active:scale-95 cursor-pointer"
            >
              Book a demo <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section with premium dark Navy Blue gradient, square grid pattern overlay and radial glow */}
      <main className="relative pt-16 pb-24 px-6 overflow-hidden bg-[#020b2d]">
        {/* Grid Lines Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-80" />
        
        {/* Central Radial Blue Glow to exactly reproduce background light source */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] bg-[radial-gradient(circle_at_center,rgba(5,67,158,0.45)_0%,rgba(2,11,45,0)_70%)] rounded-full pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[10.5px] font-mono font-bold tracking-[0.2em] text-[#00a2ff] mb-6"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#00a2ff] animate-pulse block" />
            <span>INDIA'S NEXT-GEN HRMS • AI-NATIVE</span>
          </motion.div>

          <motion.h1 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl md:text-7xl font-sans font-extrabold tracking-tight text-white leading-tight md:leading-[1.1] mb-6"
          >
            Run HR the way <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-[#7dd3fc] to-[#0ea5e9]">
              modern India deserves.
            </span>
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-base md:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed mb-8"
          >
            CognixHR unifies payroll, attendance, compliance and AI-driven workforce intelligence on one platform — built ground-up for Indian enterprises.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <button 
              id="hero-launch-tour"
              onClick={() => onLaunchDemo('admin')}
              className="w-full sm:w-auto text-sm md:text-base font-extrabold text-white bg-gradient-to-r from-blue-600 to-[#07216f] hover:from-blue-700 hover:to-[#051853] shadow-[0_10px_30px_rgba(29,78,216,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] hover:shadow-[0_12px_36px_rgba(29,78,216,0.45),inset_0_1px_0_rgba(255,255,255,0.3)] px-8 py-4 rounded-full transition-all scale-100 hover:scale-[1.03] active:scale-95 flex items-center justify-center gap-2 cursor-pointer border border-blue-500/10"
            >
              Get a free trial <ArrowRight className="w-4 h-4" />
            </button>
            <button 
              id="hero-scroll-price"
              onClick={() => onLaunchDemo('employee')}
              className="w-full sm:w-auto text-sm md:text-base font-bold text-white border border-white/20 bg-[#0a1236]/60 hover:bg-[#0c1642]/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] px-8 py-4 rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer hover:border-white/40 hover:scale-[1.01] active:scale-95 duration-200"
            >
              <svg className="w-4 h-4 fill-white text-white animate-pulse" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              Take a tour
            </button>
          </motion.div>

          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-[11px] text-slate-400 font-sans mt-7 block tracking-wide font-medium"
          >
            30-day free trial · No credit card · Cancel anytime
          </motion.span>

          <div className="h-12" />

          {/* Interactive Live Snapshot Preview */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="relative bg-white rounded-2xl border border-slate-200 shadow-2xl p-2 md:p-4 max-w-4xl mx-auto overflow-hidden group leading-normal text-slate-800"
          >
            {/* Top Bar Decoration */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 px-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
                <span className="text-xs text-slate-400 font-mono ml-2">cognixhr-cloud-hrms.co/portal</span>
              </div>
              <div className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-md text-[10px] font-bold font-mono">
                STAGE: Sandbox Environment
              </div>
            </div>

            {/* Dashboard Mock illustration */}
            <div className="bg-slate-50/70 p-4 rounded-xl text-left font-sans grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-1 bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-6 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-indigo-700 text-white font-bold flex items-center justify-center text-sm">E</div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 leading-none">Aditya Sharma</h4>
                    <span className="text-[10px] text-slate-400">Software Architect</span>
                  </div>
                </div>
                <div className="flex flex-col gap-3 font-medium text-xs text-slate-500">
                  <div className="flex items-center gap-2 text-indigo-600 bg-indigo-50/70 px-2 py-1.5 rounded-lg font-bold">
                    <Users className="w-4 h-4" /> Employee Hub
                  </div>
                  <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 transition-colors rounded-lg">
                    <Clock className="w-4 h-4" /> Time & Leaves
                  </div>
                  <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 transition-colors rounded-lg">
                    <CreditCard className="w-4 h-4" /> Pay & Slips
                  </div>
                  <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 transition-colors rounded-lg">
                    <Target className="w-4 h-4" /> Goals & OKRs
                  </div>
                </div>
              </div>

              <div className="md:col-span-3 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 border border-indigo-100 p-3 rounded-xl">
                    <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider block">Today's Punch</span>
                    <span className="text-base font-bold text-slate-800">08:52 AM</span>
                    <span className="text-[9px] text-indigo-700 block mt-1 font-semibold">● Verified On-Time</span>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 border border-purple-100 p-3 rounded-xl">
                    <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider block">Available Leaves</span>
                    <span className="text-base font-bold text-slate-800">14.5 Days</span>
                    <span className="text-[9px] text-purple-700 block mt-1 font-semibold">Sick/Casual/Privilege</span>
                  </div>
                  <div className="bg-gradient-to-br from-teal-50 to-teal-100/50 border border-teal-100 p-3 rounded-xl">
                    <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider block">Latest Appraisal Score</span>
                    <span className="text-base font-bold text-slate-800">92 / 100</span>
                    <span className="text-[9px] text-teal-700 block mt-1 font-semibold">A+ Performance</span>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm relative overflow-hidden">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-slate-800">My Attendance Board - May 2026</span>
                    <span className="text-[10px] px-2 py-0.5 bg-green-50 text-green-700 font-semibold border border-green-100 rounded-full">98.2% Regularity</span>
                  </div>
                  {/* Calender grid mockup */}
                  <div id="calendar-mockup" className="grid grid-cols-7 gap-1.5 text-center">
                    {Array.from({ length: 14 }).map((_, i) => (
                      <div key={i} className={`p-2 rounded-lg text-[10px] font-semibold ${i === 6 ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-green-50 text-green-700 border border-green-100'}`}>
                        {i + 1}
                        <span className="block text-[7px] text-slate-400 font-mono">{i === 6 ? 'Late' : 'Present'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Hover overlay explaining demo access */}
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none md:pointer-events-auto">
              <button 
                id="cta-launch-tour-over"
                onClick={() => onLaunchDemo('admin')}
                className="bg-white text-slate-900 font-bold px-6 py-3 rounded-xl shadow-[0_12px_24px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-slate-50 transition-all transform hover:scale-[1.02] cursor-pointer flex items-center gap-2 text-sm"
              >
                <Zap className="w-4 h-4 text-amber-500 fill-amber-500" /> Click to Run Live Sandbox Console
              </button>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Trust logos / Traction banner */}
      <section id="trust-banner" className="bg-white border-y border-slate-100 py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <p className="text-xs md:text-sm font-semibold tracking-wider uppercase text-slate-400 text-center md:text-left">
            Trusted by founders, finance controllers, and HR managers across the country
          </p>
          <div className="flex flex-wrap justify-center gap-8 md:gap-12 opacity-50 select-none">
            <span className="font-sans font-black text-slate-800 text-xl tracking-tight">FinScale</span>
            <span className="font-sans font-black text-slate-800 text-xl tracking-tight">Z-Nexus</span>
            <span className="font-sans font-black text-slate-800 text-xl tracking-tight">VaporTech</span>
            <span className="font-sans font-black text-slate-800 text-xl tracking-tight">AgileFlow</span>
          </div>
        </div>
      </section>

      {/* Feature Showcases Tab Box */}
      <section id="features-section" className="py-24 px-6 max-w-7xl mx-auto ScrollSection">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
            An extensive HR arsenal to nurture talent of all calibers
          </h2>
          <p className="text-slate-600 mt-4 leading-relaxed">
            Eliminate system fragmentation. Bring all elements of employee lifecycle—salaries, clock-ins, performance target systems, and applicants—under a centralized roof.
          </p>
        </div>

        {/* Tab Header Selector */}
        <div id="tabs-header-container" className="flex flex-wrap justify-center border-b border-slate-200 max-w-4xl mx-auto mb-12">
          <button
            onClick={() => setActiveTab('payroll')}
            className={`flex-1 min-w-[120px] px-6 py-4 text-center border-b-2 font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'payroll' 
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40' 
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Payroll</span>
          </button>
          <button
            onClick={() => setActiveTab('attendance')}
            className={`flex-1 min-w-[120px] px-6 py-4 text-center border-b-2 font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'attendance' 
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40' 
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Attendance</span>
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={`flex-1 min-w-[120px] px-6 py-4 text-center border-b-2 font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'performance' 
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40' 
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Target className="w-4 h-4" />
            <span>Performance</span>
          </button>
          <button
            onClick={() => setActiveTab('talent')}
            className={`flex-1 min-w-[120px] px-6 py-4 text-center border-b-2 font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              activeTab === 'talent' 
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40' 
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Briefcase className="w-4 h-4" />
            <span>Talent Finder</span>
          </button>
        </div>

        {/* Tab Panel Render */}
        <div id="feature-tabs-renderer" className="bg-white rounded-2xl border border-slate-200/80 shadow-md p-8 max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-7 space-y-6">
              <span className={`inline-flex px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-xs font-semibold text-indigo-700`}>
                {tabsContent[activeTab].badge}
              </span>
              <h3 className="text-2xl md:text-3xl font-extrabold text-slate-900 leading-tight">
                {tabsContent[activeTab].title}
              </h3>
              <p className="text-slate-600 text-sm md:text-base leading-relaxed">
                {tabsContent[activeTab].subtitle}
              </p>

              <div className="space-y-3">
                {tabsContent[activeTab].points.map((pt, ind) => (
                  <div key={ind} className="flex gap-2.5 items-start">
                    <div className="p-0.5 bg-green-50 border border-green-200 rounded-full text-green-600 mt-0.5">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-slate-700 text-xs md:text-sm">{pt}</span>
                  </div>
                ))}
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  id={`cta-active-tab-${activeTab}`}
                  onClick={() => onLaunchDemo('admin')}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-[#07216f] hover:from-blue-700 hover:to-[#051853] shadow-[0_4px_14px_rgba(29,78,216,0.25),inset_0_1px_0_rgba(255,255,255,0.2)] text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 hover:scale-[1.02] cursor-pointer"
                >
                  See in Live Demo <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="md:col-span-5 bg-gradient-to-tr from-slate-50 to-slate-100 border border-slate-200/80 p-8 rounded-xl flex flex-col justify-center items-center text-center relative overflow-hidden min-h-[300px]">
              <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-tr ${tabsContent[activeTab].accentColor} opacity-10 rounded-full blur-xl`} />
              
              <div className="space-y-4 relative z-10">
                <span className="text-5xl md:text-6xl font-extrabold tracking-tight text-slate-800">
                  {tabsContent[activeTab].stats.primary}
                </span>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 max-w-[200px] mx-auto">
                  {tabsContent[activeTab].stats.label}
                </p>
                <div className="w-20 h-1 bg-indigo-500 mx-auto rounded-full" />
                <p className="text-[11px] text-slate-400 italic">
                  Fully simulated dynamic telemetry in our sandbox environment.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparisons/Why CognixHR Section */}
      <section id="why-section" className="py-24 bg-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(99,102,241,0.15),transparent)] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold font-mono tracking-wider text-indigo-400 uppercase">Designed for people operations</span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mt-2 leading-tight">
              An HR portal employees actually love opening
            </h2>
            <p className="text-slate-400 mt-4">
              Typical database systems focus on data logs, ignoring human connection. CognixHR focuses on peer engagement, transparency, and high usability.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-800/50 border border-slate-700/60 p-8 rounded-2xl space-y-4">
              <div className="p-3 bg-indigo-500/10 border border-indigo-400/20 text-indigo-400 rounded-xl w-fit">
                <Smartphone className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold">Unmatched Mobile Readiness</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Empower field squads or delivery executives. Use our progressive web platform wrapper to enable live GPS clocking, real-time ticket logs, and leave applications on their smartphones.
              </p>
            </div>

            <div className="bg-slate-800/50 border border-slate-700/60 p-8 rounded-2xl space-y-4">
              <div className="p-3 bg-purple-500/10 border border-purple-400/20 text-purple-400 rounded-xl w-fit">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold">Error-Free Financial Payroll</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Taxes, provident funds, insurance, and performance bonuses automatically compile into individual corporate sheets. Stop running retro audits—the logic resolves calculations live.
              </p>
            </div>

            <div className="bg-slate-800/50 border border-slate-700/60 p-8 rounded-2xl space-y-4">
              <div className="p-3 bg-teal-500/10 border border-teal-400/20 text-teal-400 rounded-xl w-fit">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold">Social Recognition Corner</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Drive loyalty and reduce churn. Allow team mates to send virtual reward shoutouts, tag core values, and display peer congratulations on the organization's interactive news board.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Live Custom Calculator Section */}
      <section id="calculator-section" className="py-24 px-6 bg-slate-50 border-t border-slate-200">
        <div className="max-w-7xl mx-auto text-center space-y-12">
          
          <div className="max-w-3xl mx-auto space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs font-bold text-blue-700 uppercase tracking-widest">
              <Calculator className="w-3 h-3" /> Interactive Indian Billing Simulator
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 tracking-tight leading-tight">
              Simple, transparent pricing. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500">
                Optimized for Indian SMB slabs.
              </span>
            </h2>
            <p className="text-slate-600 leading-relaxed text-sm md:text-base">
              Say goodbye to lock-ins. Slide to match your workforce size and view custom calculated billing schedules across all three corporate subscription suites dynamically.
            </p>
          </div>

          {/* Central Simulator Console */}
          <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-slate-200 p-6 md:p-8 shadow-sm space-y-6 text-left">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-6">
              <div>
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider block">1. Configure Your Active Workforce Size</span>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Each standard subscription plan includes up to <b className="text-slate-700">100 employees</b> in its base pack.
                </span>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-2 min-w-[200px] text-center">
                <span className="text-2xl font-black text-blue-600 font-mono block leading-none">{employeeCount}</span>
                <span className="text-[10px] text-blue-500 font-semibold uppercase tracking-wider block mt-1">Users Configured</span>
              </div>
            </div>

            {/* Slider Container */}
            <div className="space-y-4 pt-2">
              <input 
                type="range"
                min="5"
                max="1000"
                step="5"
                value={employeeCount}
                onChange={(e) => setEmployeeCount(Number(e.target.value))}
                className="w-full accent-blue-600 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono font-medium">
                <span>5 employees</span>
                <span>100 (Core Base Pack Limit)</span>
                <span>500 employees</span>
                <span>1000 employees</span>
              </div>

              {/* Fast Selector Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                <span className="text-xs text-slate-400 font-bold mr-2 uppercase tracking-wide">Quick Select Team:</span>
                {[25, 50, 100, 150, 300, 500, 1000].map((size) => (
                  <button
                    key={size}
                    onClick={() => setEmployeeCount(size)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                      employeeCount === size
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {size} Users
                  </button>
                ))}
              </div>
            </div>

            {/* Flat Recruitment Optional Add-on Toggle */}
            <div className="border-t border-slate-100 pt-6">
              <div 
                onClick={() => setIncludeAts(!includeAts)}
                className={`p-4 rounded-2xl border text-left cursor-pointer transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                  includeAts 
                    ? 'border-blue-500 bg-blue-50/20 shadow-xs' 
                    : 'border-slate-250 bg-slate-50/50 hover:bg-slate-100/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl transition-colors ${
                    includeAts ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}>
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black text-slate-900 block flex items-center gap-2">
                      Enable Talent Finder Add-on (ATS Recruiting Module)
                      <span className="bg-amber-100 text-amber-800 text-[8.5px] font-black uppercase px-2 py-0.5 rounded-md">Flat Rate Add-on</span>
                    </span>
                    <span className="text-[10.5px] text-slate-500 mt-1 block leading-normal max-w-2xl">
                      Adds an independent external recruitment module. Features candidate pool pipelines, automated resume parsing, online interview stage scorecards, and multi-channel job postings tracker (+ ₹3,999/mo flat fee).
                    </span>
                  </div>
                </div>
                <div className="text-right flex items-center gap-2.5 shrink-0 self-end sm:self-auto">
                  <span className="text-sm font-black text-slate-950 font-mono block">₹3,999/mo</span>
                  <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                    includeAts ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'
                  }`}>
                    {includeAts && '✓'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Side-by-Side Plan Columns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left max-w-7xl mx-auto pt-6">
            {[
              {
                id: 'foundation',
                name: 'Foundation Plan',
                basePrice: 6999,
                extraPrice: 60,
                tagline: 'Best for standard payroll',
                desc: 'Includes essential databases, leave policy planner, and automatic payroll calculators.',
                colorClasses: {
                  card: 'border-slate-200 bg-white hover:border-slate-300',
                  button: 'bg-gradient-to-r from-slate-800 to-slate-950 hover:from-slate-900 hover:to-black text-white shadow-[0_4px_14px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.15)]',
                  badge: 'bg-slate-100 text-slate-600',
                  accent: 'text-slate-900'
                },
                highlighted: false,
                features: [
                  'Comprehensive Core Employee Records',
                  'Standard Leave Policy Planner',
                  'Statutory Payroll & Tax Engine (EPF/TDS)',
                  'Indian ESI Compliance Workflows',
                  'PDF Payslips with English-words Generator',
                  'Employee Self-Service (ESS Portal)',
                  'Digital Folder Document Cabinet',
                  'Organization Chart Directory'
                ]
              },
              {
                id: 'strength',
                name: 'Strength Plan',
                basePrice: 9999,
                extraPrice: 90,
                tagline: 'CognixHR recommended choice',
                desc: 'Adds advanced attendance, geofenced GPS tracking, expense management, and timesheets.',
                colorClasses: {
                  card: 'border-blue-500 bg-blue-950/20 shadow-lg relative ring-2 ring-blue-600/15',
                  button: 'bg-gradient-to-r from-blue-600 to-[#07216f] hover:from-blue-700 hover:to-[#051853] text-white shadow-[0_8px_24px_rgba(29,78,216,0.30),inset_0_1px_0_rgba(255,255,255,0.25)]',
                  badge: 'bg-blue-600 text-white font-extrabold',
                  accent: 'text-blue-700 font-extrabold'
                },
                highlighted: true,
                features: [
                  'Everything in Foundation included',
                  'GPS Work Location Geofencing Punching',
                  'Attendance Rules & Shifts Planner',
                  'Monthly Expense Reimbursement Flow',
                  'Timesheets & Standard Overtime Log',
                  'Device IP Access Security Limiters',
                  'Multiple Shift Calendar Rosters',
                  'Team Manager Compliance Dashboard'
                ]
              },
              {
                id: 'growth',
                name: 'Growth Plan',
                basePrice: 13999,
                extraPrice: 130,
                tagline: 'Ultimate employee suite',
                desc: 'A comprehensive corporate suite with advanced OKRs, continuous reviews, corporate assets registry, and ticketing.',
                colorClasses: {
                  card: 'border-slate-200 bg-white hover:border-slate-300',
                  button: 'bg-gradient-to-r from-slate-800 to-slate-950 hover:from-slate-900 hover:to-black text-white shadow-[0_4px_14px_rgba(15,23,42,0.15),inset_0_1px_0_rgba(255,255,255,0.15)]',
                  badge: 'bg-purple-100 text-purple-800',
                  accent: 'text-purple-700'
                },
                highlighted: false,
                features: [
                  'Everything in Strength included',
                  'Continuous Appraisals Manager',
                  'SMART Goals & Enterprise OKRs',
                  'Peer Feedback & Peer Recognition Shoutouts',
                  'Core Corporate Assets Inventory Registry',
                  'IT & HR Helpdesk Internal Ticketing',
                  'Annual Appraisal Cycle Automations',
                  'Advanced Performance Analytics Graphs'
                ]
              }
            ].map((plan) => {
              const baseValue = plan.basePrice;
              const extraValue = plan.extraPrice;
              const extraUsers = Math.max(0, employeeCount - 100);
              const extraCostTotal = extraUsers * extraValue;
              const atsCostValue = includeAts ? 3999 : 0;
              const subtotalPrice = baseValue + extraCostTotal + atsCostValue;
              const gstValue = Math.round(subtotalPrice * 0.18);
              const totalPriceWithTax = subtotalPrice + gstValue;
              const averageCostPerUser = Math.round(totalPriceWithTax / employeeCount);

              return (
                <div
                  key={plan.id}
                  className={`border p-6 rounded-3xl flex flex-col justify-between transition-all ${plan.colorClasses.card}`}
                >
                  <div className="space-y-6">
                    {/* Header */}
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <span className={`text-[9px] font-black tracking-widest uppercase px-2.5 py-1 rounded-md block w-fit mb-2 ${plan.colorClasses.badge}`}>
                          {plan.id === 'strength' ? '★ Recommended Standard' : plan.id === 'growth' ? '👑 Enterprise Growth' : '✓ Foundation Core'}
                        </span>
                        <h3 className="text-xl font-black text-slate-900 tracking-tight leading-none">{plan.name}</h3>
                        <span className="text-[11px] text-slate-400 block mt-1.5 font-medium italic">{plan.tagline}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-500 leading-relaxed min-h-[44px]">
                      {plan.desc}
                    </p>

                    {/* Dynamic Pricing Counter Block */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3.5">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Est. Subtotal (Excl. Tax)</span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                          <span className="text-3xl font-black text-slate-950 font-mono">₹{subtotalPrice.toLocaleString('en-IN')}</span>
                          <span className="text-xs text-slate-500 font-semibold">/month</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-[10.5px] border-t border-slate-200/60 pt-3 text-slate-500 font-medium">
                        <div className="flex justify-between">
                          <span>Base Pack (First 100 Users)</span>
                          <span className="font-mono text-slate-800 font-bold">₹{baseValue.toLocaleString('en-IN')}</span>
                        </div>
                        {extraUsers > 0 && (
                          <div className="flex justify-between">
                            <span>Extra ({extraUsers} users @ ₹{extraValue})</span>
                            <span className="font-mono text-slate-800 font-bold">+₹{extraCostTotal.toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        {includeAts && (
                          <div className="flex justify-between text-blue-600">
                            <span>Talent Finder Recruiting</span>
                            <span className="font-mono font-bold">+₹3,999</span>
                          </div>
                        )}
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>CGST/SGST Tax (18%)</span>
                          <span className="font-mono">₹{gstValue.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between text-slate-900 font-extrabold border-t border-slate-200/50 pt-2 text-[11px] bg-slate-100/30 px-1 rounded">
                          <span>Gross Estimated Bill</span>
                          <span className="font-mono text-blue-600">₹{totalPriceWithTax.toLocaleString('en-IN')}</span>
                        </div>
                      </div>

                      <div className="text-[9.5px] text-slate-400 pt-1 leading-none text-center block">
                        Fits your ROI at <b className="text-slate-700 font-mono">₹{averageCostPerUser}/user/mo</b> gross average.
                      </div>
                    </div>

                    {/* Feature Lists */}
                    <div className="space-y-3 pt-2">
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Features included in this suite:</span>
                      <ul className="space-y-2.5">
                        {plan.features.map((feat, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-650 leading-relaxed font-medium">
                            <span className="p-0.5 bg-blue-50 text-blue-600 rounded-full shrink-0 block mt-0.5">
                              <Check className="w-3 h-3 text-blue-600" />
                            </span>
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Sandbox CTA Button */}
                  <div className="pt-8">
                    <button
                      onClick={() => onLaunchDemo('admin')}
                      className={`w-full py-3.5 rounded-xl text-center text-xs font-black uppercase tracking-wider transition-all scale-100 hover:scale-[1.01] flex items-center justify-center gap-1.5 cursor-pointer ${plan.colorClasses.button}`}
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" /> Activate {plan.name.split(' ')[0]} Sandbox
                    </button>
                    <span className="text-[9px] text-slate-400 block text-center mt-2 font-medium">
                      No cards required. Instantly boots pre-loaded sandbox mock data.
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pricing Bottom Certifications */}
          <div className="max-w-4xl mx-auto pt-6 border-t border-slate-200">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center text-xs text-slate-500 font-bold">
              <div className="p-4 bg-white rounded-2xl border border-slate-200/60 shadow-2xs space-y-1">
                <span className="text-slate-900 font-black block leading-none">Zero Onboarding Fees</span>
                <span className="text-[10px] text-slate-400 block font-medium">Free guided setup, spreadsheets migration.</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-slate-200/60 shadow-2xs space-y-1">
                <span className="text-slate-900 font-black block leading-none">No Minimum Lock-ins</span>
                <span className="text-[10px] text-slate-400 block font-medium">Downgrade, upgrade, or cancel any time.</span>
              </div>
              <div className="p-4 bg-white rounded-2xl border border-slate-200/60 shadow-2xs space-y-1">
                <span className="text-slate-900 font-black block leading-none">Compliance Certifications</span>
                <span className="text-[10px] text-slate-400 block font-medium">Calculations tested by statutory Indian auditors.</span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Enterprise Security Section */}
      <section id="security-section" className="py-24 px-6 bg-white border-t border-slate-100">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <div className="p-3 bg-green-50 border border-green-100 text-green-600 rounded-2xl w-fit mx-auto">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
            Bank-level encryption and full regulatory compliance
          </h2>
          <p className="text-slate-600 text-sm md:text-base leading-relaxed max-w-2xl mx-auto">
            All database pipelines, tax calculation summaries, and employee credentials are secured via TLS 1.3 encryption mechanisms, isolated databases, and continuous recovery standards.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-xs text-slate-500 font-semibold pt-4">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-indigo-600" /> GDPR Aligned</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-indigo-600" /> Statutory Tax Compliant</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-indigo-600" /> Weekly SOC-2 Scans</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-6 border-t border-slate-800">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-teal-400 flex items-center justify-center text-white font-bold text-base">C</div>
              <span className="font-bold text-white tracking-tight text-base">Cognix<span className="text-teal-400">HR</span></span>
            </div>
            <p className="text-xs leading-normal">
              Next-generation modern HR, Payroll, Geofenced time sheets and ATS, modeled on transparent corporate alignment.
            </p>
            <p className="text-[10px] text-slate-500 font-mono">
              © 2026 CognixHR HR Technology. All rights reserved.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200 tracking-wider uppercase">Product Modules</h4>
            <ul className="text-xs space-y-2">
              <li><a href="#" className="hover:text-white transition-colors">Core HR Portal</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Payroll & Taxes</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Time Attendance Sheets</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Candidate ATS Tracking</a></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200 tracking-wider uppercase">Comparison</h4>
            <ul className="text-xs space-y-2">
              <li><a href="#" className="hover:text-white transition-colors">CognixHR vs Competitors</a></li>
              <li><a href="#" className="hover:text-white transition-colors">CognixHR vs Darwinbox</a></li>
              <li><a href="#" className="hover:text-white transition-colors">CognixHR vs BambooHR</a></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-200 tracking-wider uppercase">Workspace Integrations</h4>
            <ul className="text-xs space-y-2">
              <li><a href="#" className="hover:text-white transition-colors">Slack Integrations</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Biometric Gate Integration</a></li>
              <li><a href="#" className="hover:text-white transition-colors">HDFC, ICICI, SBI Banking Link</a></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
