import React from 'react';
import {
  Users, UserCheck, UserPlus, UserX, AlertTriangle, Clock,
  CheckCircle2, Activity, TrendingUp, CalendarDays,
} from 'lucide-react';

const EMPLOYEES = [
  { name: 'Priya Sharma', dept: 'HR', status: 'On-time', code: 'SAAR001' },
  { name: 'Rahul Verma', dept: 'Engineering', status: 'On-time', code: 'SAAR002' },
  { name: 'Ananya Iyer', dept: 'Engineering', status: 'Late', code: 'SAAR003' },
  { name: 'Kavya Menon', dept: 'Sales', status: 'On-time', code: 'SAAR007' },
  { name: 'Pooja Desai', dept: 'Finance', status: 'On-time', code: 'SAAR013' },
  { name: 'Aditya Kulkarni', dept: 'Sales', status: 'On Leave', code: 'SAAR010' },
];

const ABSENT_TREND = [3, 1, 2, 1, 0, 1, 2, 1, 3, 1, 0, 1, 2, 1];
const MAX_ABSENT = 4;

const KPI_CARDS = [
  { label: 'Total Employees', value: '22', icon: Users, color: 'text-slate-700', bg: 'bg-slate-100', border: 'border-slate-200', top: '' },
  { label: 'Active', value: '20', sub: '90.9% of total', icon: UserCheck, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100', top: 'bg-emerald-500' },
  { label: 'New Joiners', value: '2', sub: 'This month', icon: UserPlus, color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-100', top: 'bg-[#2E6FE6]' },
  { label: 'Absent Today', value: '1', sub: 'Marked absent', icon: UserX, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-100', top: 'bg-amber-500' },
  { label: 'Anomalies', value: '0', sub: 'All resolved', icon: AlertTriangle, color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200', top: '' },
  { label: 'Pending Corrections', value: '0', sub: 'No SLA breach', icon: Clock, color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200', top: '' },
];

export default function AdminDashboardPreview() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#2E6FE6]" />
            Workspace Overview
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">June 2026 · Saar Technologies Pvt Ltd</p>
        </div>
        <span className="text-[10px] font-mono font-semibold text-[#15B8A6] bg-[#15B8A6]/10 border border-[#15B8A6]/20 px-2.5 py-1 rounded-full">
          ● Live
        </span>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
        {KPI_CARDS.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`relative rounded-xl border ${k.border} bg-white overflow-hidden`}>
              {k.top && <div className={`h-0.5 w-full ${k.top}`} />}
              <div className="p-2.5">
                <div className={`w-6 h-6 rounded-lg ${k.bg} flex items-center justify-center mb-1.5`}>
                  <Icon className={`w-3.5 h-3.5 ${k.color}`} />
                </div>
                <div className={`text-base font-extrabold font-mono leading-none ${k.color}`}>{k.value}</div>
                <div className="text-[9px] text-slate-400 font-medium mt-0.5 leading-tight">{k.label}</div>
                {k.sub && <div className="text-[8px] text-slate-300 mt-0.5 leading-tight">{k.sub}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-5 gap-3">
        {/* Absent Trend bar chart */}
        <div className="col-span-3 bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] font-bold text-slate-700">Absent Trend</div>
              <div className="text-[9px] text-slate-400">Last 14 days · daily count</div>
            </div>
            <span className="text-[9px] font-mono text-[#2E6FE6] bg-[#2E6FE6]/10 px-2 py-0.5 rounded-full">Muster Roll →</span>
          </div>
          <div className="flex items-end gap-1 h-12">
            {ABSENT_TREND.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5">
                <div
                  className={`w-full rounded-sm transition-all ${v > 1 ? 'bg-amber-400' : 'bg-[#2E6FE6]/40'}`}
                  style={{ height: `${Math.max(4, (v / MAX_ABSENT) * 44)}px` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[8px] text-slate-300">Jun 6</span>
            <span className="text-[8px] text-slate-300">Jun 19</span>
          </div>
        </div>

        {/* Employment Types mini donut */}
        <div className="col-span-2 bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-700">Employment Types</div>
            <div className="text-[9px] text-slate-400">Headcount breakdown</div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <svg viewBox="0 0 36 36" className="w-14 h-14 shrink-0">
              {/* Permanent 16/22 = 72.7% → 261.8° */}
              <circle cx="18" cy="18" r="14" fill="none" stroke="#2E6FE6" strokeWidth="5"
                strokeDasharray="63.8 26.2" strokeDashoffset="0" />
              {/* Probation 4/22 = 18.2% → 65.5° */}
              <circle cx="18" cy="18" r="14" fill="none" stroke="#15B8A6" strokeWidth="5"
                strokeDasharray="16 74" strokeDashoffset="-63.8" />
              {/* Contract 2/22 = 9.1% → 32.7° */}
              <circle cx="18" cy="18" r="14" fill="none" stroke="#F59E0B" strokeWidth="5"
                strokeDasharray="8 82" strokeDashoffset="-79.8" />
            </svg>
            <div className="space-y-1.5 text-[9px]">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#2E6FE6] shrink-0" /><span className="text-slate-600">Permanent <span className="font-bold text-slate-800">16</span></span></div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#15B8A6] shrink-0" /><span className="text-slate-600">Probation <span className="font-bold text-slate-800">4</span></span></div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" /><span className="text-slate-600">Intern <span className="font-bold text-slate-800">2</span></span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Who-is-in today strip */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-100">
          <div className="text-[11px] font-bold text-slate-700">Who-is-In · Today</div>
          <div className="flex items-center gap-3 text-[9px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Present</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Late</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-300" />Leave</span>
          </div>
        </div>
        <div className="divide-y divide-slate-50">
          {EMPLOYEES.map((e) => (
            <div key={e.code} className="flex items-center justify-between px-3.5 py-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 ${
                  e.status === 'On Leave' ? 'bg-slate-400' : e.status === 'Late' ? 'bg-amber-500' : 'bg-[#2E6FE6]'
                }`}>
                  {e.name.split(' ').map(n => n[0]).join('')}
                </div>
                <span className="text-[11px] font-semibold text-slate-700">{e.name}</span>
                <span className="text-[9px] text-slate-400">{e.dept}</span>
              </div>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                e.status === 'On Leave' ? 'bg-slate-100 text-slate-500' :
                e.status === 'Late' ? 'bg-amber-50 text-amber-700' :
                'bg-emerald-50 text-emerald-700'
              }`}>
                {e.status}
              </span>
            </div>
          ))}
        </div>
        <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-100 flex gap-4 text-[9px]">
          <span className="font-bold text-emerald-700">19 Present</span>
          <span className="font-bold text-amber-600">1 Late</span>
          <span className="font-bold text-slate-500">1 On Leave</span>
          <span className="font-bold text-rose-600">1 Absent</span>
          <span className="font-bold text-slate-400 ml-auto">0 Anomalies · All clear</span>
        </div>
      </div>
    </div>
  );
}
