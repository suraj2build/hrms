import React, { useState } from 'react';
import { Briefcase, Users, Calendar, CheckCircle2, Clock, XCircle, ChevronRight, Search, Filter, Mail } from 'lucide-react';

interface Requisition {
  id: string;
  title: string;
  dept: string;
  location: string;
  openings: number;
  status: 'Active' | 'Hired';
  created: string;
}

interface Candidate {
  id: string;
  name: string;
  role: string;
  stage: 'Applied' | 'Screening' | 'Interview' | 'Offered' | 'Hired' | 'Rejected';
  score: number;
  applied: string;
  exp: string;
  req: string;
}

const REQUISITIONS: Requisition[] = [
  { id: 'REQ-001', title: 'Senior Software Engineer', dept: 'Engineering', location: 'Bengaluru', openings: 2, status: 'Active', created: '2026-05-10' },
  { id: 'REQ-002', title: 'Sales Manager — South India', dept: 'Sales', location: 'Mumbai', openings: 1, status: 'Active', created: '2026-05-18' },
  { id: 'REQ-003', title: 'Finance Analyst', dept: 'Finance', location: 'Bengaluru', openings: 1, status: 'Hired', created: '2026-04-22' },
];

// Roles align with each requisition; per-stage funnel counts are computed
// from this list at render time so the pipeline is always internally consistent.
const CANDIDATES: Candidate[] = [
  // REQ-001 — Senior Software Engineer
  { id: 'CAN-101', name: 'Nandini Gupta',  role: 'Platform / DevOps Engineer',   stage: 'Hired',     score: 91, applied: '2026-05-20', exp: '5 yrs',   req: 'REQ-001' },
  { id: 'CAN-102', name: 'Arjun Rampal',   role: 'Full-Stack Engineer (Node/React)', stage: 'Offered', score: 94, applied: '2026-05-24', exp: '6 yrs', req: 'REQ-001' },
  { id: 'CAN-103', name: 'Deepak Chawla',  role: 'Senior Backend Engineer',       stage: 'Interview', score: 88, applied: '2026-05-28', exp: '4.5 yrs', req: 'REQ-001' },
  { id: 'CAN-104', name: 'Rohit Saxena',   role: 'Backend Engineer (Go)',         stage: 'Screening', score: 79, applied: '2026-06-01', exp: '4 yrs',   req: 'REQ-001' },
  { id: 'CAN-105', name: 'Tara Krishnan',  role: 'Frontend Engineer (React)',     stage: 'Applied',   score: 76, applied: '2026-06-05', exp: '3 yrs',   req: 'REQ-001' },
  { id: 'CAN-106', name: 'Imran Sheikh',   role: 'Senior Software Engineer',      stage: 'Applied',   score: 72, applied: '2026-06-07', exp: '7 yrs',   req: 'REQ-001' },
  // REQ-002 — Sales Manager, South India
  { id: 'CAN-201', name: 'Sneha Sen',      role: 'Regional Sales Manager',        stage: 'Interview', score: 85, applied: '2026-05-26', exp: '8 yrs',   req: 'REQ-002' },
  { id: 'CAN-202', name: 'Manoj Pillai',   role: 'Sales Manager',                 stage: 'Screening', score: 77, applied: '2026-05-30', exp: '6 yrs',   req: 'REQ-002' },
  { id: 'CAN-203', name: 'Divya Nair',     role: 'Territory Sales Lead',          stage: 'Applied',   score: 80, applied: '2026-06-04', exp: '5 yrs',   req: 'REQ-002' },
  { id: 'CAN-204', name: 'Vikrant Patil',  role: 'Area Sales Manager',            stage: 'Rejected',  score: 52, applied: '2026-05-15', exp: '10 yrs',  req: 'REQ-002' },
  // REQ-003 — Finance Analyst
  { id: 'CAN-301', name: 'Ayesha Ahmed',   role: 'Financial Analyst',             stage: 'Hired',     score: 88, applied: '2026-04-28', exp: '3 yrs',   req: 'REQ-003' },
  { id: 'CAN-302', name: 'Karan Mehta',    role: 'Finance Analyst (FP&A)',        stage: 'Interview', score: 81, applied: '2026-05-02', exp: '4 yrs',   req: 'REQ-003' },
  { id: 'CAN-303', name: 'Priyanka Joshi', role: 'Costing & Finance Analyst',     stage: 'Screening', score: 75, applied: '2026-05-06', exp: '2.5 yrs', req: 'REQ-003' },
];

const FUNNEL_STAGES = ['Applied', 'Screening', 'Interview', 'Offered', 'Hired'] as const;

function funnelCounts(reqId: string): Record<string, number> {
  const counts: Record<string, number> = { Applied: 0, Screening: 0, Interview: 0, Offered: 0, Hired: 0 };
  for (const c of CANDIDATES) {
    if (c.req === reqId && c.stage in counts) counts[c.stage] += 1;
  }
  return counts;
}

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  Applied:   { label: 'Applied',   color: 'text-slate-600',   bg: 'bg-slate-100',   dot: 'bg-slate-400' },
  Screening: { label: 'Screening', color: 'text-blue-700',    bg: 'bg-blue-50',     dot: 'bg-[#2E6FE6]' },
  Interview: { label: 'Interview', color: 'text-violet-700',  bg: 'bg-violet-50',   dot: 'bg-violet-500' },
  Offered:   { label: 'Offered',   color: 'text-amber-700',   bg: 'bg-amber-50',    dot: 'bg-amber-500' },
  Hired:     { label: 'Hired',     color: 'text-emerald-700', bg: 'bg-emerald-50',  dot: 'bg-emerald-500' },
  Rejected:  { label: 'Rejected',  color: 'text-red-600',     bg: 'bg-red-50',      dot: 'bg-red-400' },
};

function scoreColor(s: number) {
  if (s >= 85) return 'text-emerald-700 bg-emerald-50';
  if (s >= 70) return 'text-blue-700 bg-blue-50';
  return 'text-amber-700 bg-amber-50';
}

export default function RecruitmentPipeline() {
  const [activeReq, setActiveReq] = useState('REQ-001');
  const req = REQUISITIONS.find(r => r.id === activeReq)!;
  const reqCandidates = CANDIDATES.filter(c => c.req === activeReq);

  const stageCounts = funnelCounts(activeReq);
  const totalPipeline = Object.values(stageCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex gap-0 h-[420px] text-left select-none" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Left sidebar — requisitions list */}
      <div className="w-[240px] shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/60 rounded-l-xl">
        <div className="px-3 py-3 border-b border-slate-200">
          <div className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5 mb-2">
            <Briefcase className="w-3.5 h-3.5 text-[#2E6FE6]" />
            Open Requisitions
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <input
              readOnly
              placeholder="Search roles..."
              className="w-full bg-white border border-slate-200 rounded-md text-[10px] pl-6 pr-2 py-1.5 text-slate-400 placeholder-slate-300"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {REQUISITIONS.map(r => (
            <button
              key={r.id}
              onClick={() => setActiveReq(r.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors ${
                activeReq === r.id ? 'bg-white border-l-2 border-l-[#2E6FE6]' : 'hover:bg-white/70'
              }`}
            >
              <div className="flex items-start justify-between gap-1 mb-0.5">
                <span className={`text-[10.5px] font-bold leading-snug ${activeReq === r.id ? 'text-[#2E6FE6]' : 'text-slate-700'}`}>
                  {r.title}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[9px] text-slate-400">{r.dept}</span>
                <span className="text-[8px] text-slate-300">·</span>
                <span className="text-[9px] text-slate-400">{r.location}</span>
                <span className="text-[8px] text-slate-300">·</span>
                <span className="text-[9px] text-slate-400">{CANDIDATES.filter(c => c.req === r.id).length} candidates</span>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  r.status === 'Hired' ? 'bg-emerald-50 text-emerald-700' : 'bg-[#2E6FE6]/10 text-[#2E6FE6]'
                }`}>
                  {r.status}
                </span>
                <span className="text-[9px] text-slate-400 font-mono">{r.id}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-slate-200">
          <button className="w-full text-[10px] font-bold text-[#2E6FE6] bg-[#2E6FE6]/10 hover:bg-[#2E6FE6]/20 rounded-lg py-1.5 transition-colors">
            + New Requisition
          </button>
        </div>
      </div>

      {/* Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden rounded-r-xl">
        {/* Req header */}
        <div className="px-4 py-3 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">{req.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                <span>{req.dept}</span>
                <span>·</span>
                <span>{req.location}</span>
                <span>·</span>
                <span>{req.openings} opening{req.openings > 1 ? 's' : ''}</span>
                <span>·</span>
                <span>Opened {req.created}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                req.status === 'Hired' ? 'bg-emerald-50 text-emerald-700' : 'bg-[#2E6FE6]/10 text-[#2E6FE6]'
              }`}>
                {req.status}
              </span>
            </div>
          </div>

          {/* Stage funnel strip */}
          <div className="flex items-center gap-1.5 mt-3">
            {FUNNEL_STAGES.map((stageName, i) => {
              const count = stageCounts[stageName];
              const cfg = STAGE_CONFIG[stageName];
              return (
                <React.Fragment key={stageName}>
                  <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${cfg.bg} ${cfg.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                    {stageName} <span className="font-mono ml-0.5">{count}</span>
                  </div>
                  {i < 4 && <ChevronRight className="w-2.5 h-2.5 text-slate-300 shrink-0" />}
                </React.Fragment>
              );
            })}
            <span className="ml-auto text-[9px] text-slate-400 font-mono">{totalPipeline} total</span>
          </div>
        </div>

        {/* Candidates list */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Candidates · {req.id}</span>
            <div className="flex items-center gap-2">
              <button className="text-[9px] font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1 px-2 py-1 rounded border border-slate-200">
                <Filter className="w-2.5 h-2.5" /> Filter
              </button>
              <button className="text-[9px] font-bold text-white bg-[#2E6FE6] px-2.5 py-1 rounded transition-colors hover:bg-[#1A5FD5]">
                + Add Candidate
              </button>
            </div>
          </div>

          {reqCandidates.length > 0 ? (
            <div className="divide-y divide-slate-50">
              {reqCandidates.map(c => {
                const cfg = STAGE_CONFIG[c.stage];
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${
                      c.stage === 'Hired' ? 'bg-emerald-500' :
                      c.stage === 'Rejected' ? 'bg-red-400' :
                      'bg-[#2E6FE6]'
                    }`}>
                      {c.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11.5px] font-bold text-slate-800">{c.name}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${scoreColor(c.score)}`}>{c.score}%</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[9.5px] text-slate-400">
                        <Briefcase className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{c.role}</span>
                        <span className="shrink-0">· {c.exp} exp</span>
                        <Calendar className="w-2.5 h-2.5 shrink-0 ml-1" />
                        <span className="shrink-0">{c.applied}</span>
                      </div>
                    </div>
                    {/* Stage */}
                    <div className="shrink-0 flex items-center gap-2">
                      <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${cfg.bg} ${cfg.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {c.stage}
                      </span>
                      {c.stage === 'Interview' && (
                        <button className="text-[9px] text-violet-600 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded font-semibold hover:bg-violet-100 transition-colors">
                          Schedule
                        </button>
                      )}
                      {c.stage === 'Offered' && (
                        <button className="text-[9px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded font-semibold hover:bg-amber-100 transition-colors">
                          View Offer
                        </button>
                      )}
                      {c.stage === 'Hired' && (
                        <button className="text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded font-semibold">
                          Onboard →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-slate-300">
              <Users className="w-10 h-10 mb-2" />
              <span className="text-xs">No candidates yet for this requisition</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
