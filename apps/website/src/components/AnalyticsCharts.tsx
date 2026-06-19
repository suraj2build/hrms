import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface AnalyticsChartsProps {
  employees: any[];
  candidates: any[];
  attendance: any[];
}

const DEPT_COLORS = {
  Engineering: '#2E6FE6', // CognixHR royal blue
  Sales: '#15B8A6',       // CognixHR teal
  HR: '#1A4FA0',          // deep navy blue
  Marketing: '#F59E0B',   // amber
  Operations: '#10B981',  // emerald
  Finance: '#0F766E'      // dark teal
};

export default function AnalyticsCharts({ employees, candidates, attendance }: AnalyticsChartsProps) {

  // 1. Process Payroll Spend by Department
  const deptSpend = employees.reduce((acc: any, emp) => {
    const dept = emp.department;
    if (!acc[dept]) acc[dept] = 0;
    acc[dept] += emp.salary;
    return acc;
  }, {});

  const pieData = Object.keys(deptSpend).map(dept => ({
    name: dept,
    value: deptSpend[dept],
    color: DEPT_COLORS[dept as keyof typeof DEPT_COLORS] || '#a1a1aa'
  }));

  // 2. Process Attendance Stats over the past week (simulated data)
  const attendanceData = [
    { name: 'Mon', 'On-Time': 7, Late: 1, 'Half-Day': 0, Absent: 0 },
    { name: 'Tue', 'On-Time': 6, Late: 2, 'Half-Day': 0, Absent: 0 },
    { name: 'Wed', 'On-Time': 5, Late: 1, 'Half-Day': 1, Absent: 1 },
    { name: 'Thu', 'On-Time': 7, Late: 0, 'Half-Day': 1, Absent: 0 },
    { name: 'Fri', 'On-Time': 4, Late: 3, 'Half-Day': 0, Absent: 1 },
  ];

  // 3. Process Candidates per Recruitment Stage
  const candidateStages = candidates.reduce((acc: any, cand) => {
    const stg = cand.stage;
    if (!acc[stg]) acc[stg] = 0;
    acc[stg] += 1;
    return acc;
  }, {});

  const barData = [
    { stage: 'Applied', Count: candidateStages['Applied'] || 0, color: '#94a3b8' },
    { stage: 'Screening', Count: candidateStages['Screening'] || 0, color: '#3b82f6' },
    { stage: 'Interview', Count: candidateStages['Interview'] || 0, color: '#a855f7' },
    { stage: 'Offered', Count: candidateStages['Offered'] || 0, color: '#f59e0b' },
    { stage: 'Hired', Count: candidateStages['Hired'] || 0, color: '#10b981' },
  ];

  // Custom formatting for money values in Indian Rupees
  const formatCurrency = (tick: any) => {
    return `₹${(tick / 1000).toFixed(0)}k`;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

      {/* Spend chart */}
      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-col justify-between">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Monthly Spend by Dept</h4>
          <span className="text-[10px] text-slate-400 font-medium">Budget breakdown per business team</span>
        </div>
        <div className="h-[240px] flex items-center justify-center py-4 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={4}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(val) => [`₹${Number(val).toLocaleString('en-IN')}`, 'Monthly Spend']} />
            </PieChart>
          </ResponsiveContainer>

          {/* Central Label inside Donut */}
          <div className="absolute text-center mt-2">
            <span className="text-[10px] text-slate-400 tracking-wider uppercase font-semibold">Total Base</span>
            <span className="text-lg font-black text-slate-800 block">
              ₹{employees.reduce((sum, e) => sum + e.salary, 0).toLocaleString('en-IN')}
            </span>
          </div>
        </div>

        {/* Custom Legend grids */}
        <div className="grid grid-cols-3 gap-2 text-[10px] pt-2 border-t border-slate-50">
          {pieData.map((item, index) => (
            <div key={index} className="flex items-center gap-1.5 font-medium text-slate-600">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="truncate" title={item.name}>{item.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Attendance Trends */}
      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-col justify-between">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Attendance Statistics</h4>
          <span className="text-[10px] text-slate-400 font-medium">Weekly presence ratios across organization</span>
        </div>
        <div className="h-[240px] py-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={attendanceData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(99,102,241,0.04)' }} />
              <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 10, paddingTop: 10 }} />
              <Bar dataKey="On-Time" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Late" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Half-Day" stackId="a" fill="#a855f7" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Absent" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recruitment ATS statistics */}
      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-col justify-between">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Recruitment Funnel</h4>
          <span className="text-[10px] text-slate-400 font-medium">Applicants flow per pipeline category</span>
        </div>
        <div className="h-[240px] py-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={barData}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis dataKey="stage" type="category" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(99,102,241,0.04)' }} />
              <Bar dataKey="Count" fill="#cbd5e1" radius={[0, 4, 4, 0]}>
                {barData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  );
}
