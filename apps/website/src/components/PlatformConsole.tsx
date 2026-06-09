import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  CreditCard,
  Clock,
  Target,
  Briefcase,
  HelpCircle,
  Home,
  Menu,
  ChevronRight,
  Plus,
  TrendingUp,
  Sliders,
  DollarSign,
  Award,
  AlertCircle,
  BookOpen,
  Send,
  Sparkles,
  User,
  ShieldAlert,
  ArrowLeft,
  X,
  FileText,
  Search,
  Check,
  Building,
  Heart,
  ChevronLeft,
  HelpCircle as TicketIcon,
  Upload
} from 'lucide-react';

import { 
  Employee, 
  Candidate, 
  LeaveRequest, 
  AttendanceLog, 
  HelpdeskTicket, 
  Announcement, 
  PublicShoutout, 
  PayrollRecord,
  ExpenseClaim
} from '../types';

import {
  INITIAL_EMPLOYEES,
  INITIAL_CANDIDATES,
  INITIAL_LEAVE_REQUESTS,
  INITIAL_ATTENDANCE_LOGS,
  INITIAL_ANNOUNCEMENTS,
  INITIAL_FEEDBACK_POSTS,
  INITIAL_TICKETS,
  INITIAL_EXPENSES,
  getInitialPayrollRecords
} from '../mockData';

import ClockWidget from './ClockWidget';
import PayslipModal from './PayslipModal';
import CandidateATS from './CandidateATS';
import AnalyticsCharts from './AnalyticsCharts';

interface PlatformConsoleProps {
  initialPersona: 'admin' | 'employee';
  onExit: () => void;
}

export default function PlatformConsole({ initialPersona, onExit }: PlatformConsoleProps) {
  // 1. Role / View controllers
  const [roleMode, setRoleMode] = useState<'admin' | 'employee'>(initialPersona);
  const [activeAdminTab, setActiveAdminTab] = useState<'dashboard' | 'directory' | 'payroll' | 'leaves' | 'ats' | 'expenses'>('dashboard');
  const [activeEmployeeTab, setActiveEmployeeTab] = useState<'dashboard' | 'leaves' | 'payslips' | 'helpdesk'>('dashboard');

  // 2. Centralized Corporate Reactive States
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [candidates, setCandidates] = useState<Candidate[]>(INITIAL_CANDIDATES);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(INITIAL_LEAVE_REQUESTS);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>(INITIAL_ATTENDANCE_LOGS);
  const [announcements, setAnnouncements] = useState<Announcement[]>(INITIAL_ANNOUNCEMENTS);
  const [tickets, setTickets] = useState<HelpdeskTicket[]>(INITIAL_TICKETS);
  const [shoutouts, setShoutouts] = useState<PublicShoutout[]>(INITIAL_FEEDBACK_POSTS);
  const [expenses, setExpenses] = useState<ExpenseClaim[]>(INITIAL_EXPENSES);

  // Initialize Payroll with employee data
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>(getInitialPayrollRecords(INITIAL_EMPLOYEES));

  // Simulated login employee session (By default Aditya, EMP-101)
  const [loggedInEmployee, setLoggedInEmployee] = useState<Employee>(INITIAL_EMPLOYEES[0]);

  // Modals / Details focus
  const [selectedPayslipRecord, setSelectedPayslipRecord] = useState<PayrollRecord | null>(null);
  const [selectedPayslipEmployee, setSelectedPayslipEmployee] = useState<Employee | null>(null);
  const [selectedDirectoryEmployee, setSelectedDirectoryEmployee] = useState<Employee | null>(null);
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [payrollProcessingMsg, setPayrollProcessingMsg] = useState('');
  const [isProcessingPayroll, setIsProcessingPayroll] = useState(false);

  // Leave Submit State
  const [newLeaveForm, setNewLeaveForm] = useState({
    type: 'Casual Leave',
    startDate: '',
    endDate: '',
    reason: '',
    days: 1
  });
  const [leaveSubmitSuccess, setLeaveSubmitSuccess] = useState(false);

  // Ticket Submit State
  const [newTicketForm, setNewTicketForm] = useState({
    title: '',
    category: 'IT Support' as any,
    description: '',
    priority: 'Medium' as any
  });
  const [ticketSubmitSuccess, setTicketSubmitSuccess] = useState(false);

  // Shoutout Submit State
  const [newShoutoutForm, setNewShoutoutForm] = useState({
    receiverId: '',
    message: '',
    badge: 'Collaboration' as any
  });
  const [shoutoutSuccess, setShoutoutSuccess] = useState(false);

  // Employee Add form state
  const [employeeForm, setEmployeeForm] = useState({
    name: '',
    email: '',
    role: '',
    department: 'Engineering' as any,
    salary: 80000,
    phone: '',
    workMode: 'Hybrid' as any
  });

  // Filter & Searching Directory
  const [dirSearch, setDirSearch] = useState('');
  const [dirDeptFilter, setDirDeptFilter] = useState('All');

  // --- ACTIONS HANDLERS ---

  // Update a candidate in pipeline
  const handleUpdateCandidate = (updated: Candidate) => {
    setCandidates(prev => prev.map(c => c.id === updated.id ? updated : c));
  };

  // Register applicant from candidate component
  const handleAddCandidate = (newCand: Candidate) => {
    setCandidates(prev => [newCand, ...prev]);
  };

  // Adding Employee to the real system database
  const handleCreateEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeForm.name || !employeeForm.email) return;

    const newId = `EMP-${100 + employees.length + 1}`;
    const newEmp: Employee = {
      id: newId,
      name: employeeForm.name,
      email: employeeForm.email,
      role: employeeForm.role || 'Junior Associate',
      department: employeeForm.department,
      joinedDate: new Date().toISOString().split('T')[0],
      salary: Number(employeeForm.salary) || 60000,
      status: 'Active',
      workMode: employeeForm.workMode,
      phone: employeeForm.phone || '+91 90001 00002',
      avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=150&auto=format&fit=crop", // placeholder
      manager: 'Kavita Rao'
    };

    setEmployees(prev => [newEmp, ...prev]);
    // Also bootstrap a baseline payroll record
    const base = Math.round(newEmp.salary * 0.5);
    const hra = Math.round(base * 0.4);
    const allowance = newEmp.salary - base - hra;
    const pf = Math.round(base * 0.12);
    const tax = Math.round(newEmp.salary * 0.12);
    const net = newEmp.salary - pf - tax;

    const newPay: PayrollRecord = {
      employeeId: newId,
      employeeName: newEmp.name,
      department: newEmp.department,
      role: newEmp.role,
      basicSalary: base,
      hra: hra,
      specialAllowance: allowance,
      pfDeduction: pf,
      taxDeduction: tax,
      grossSalary: newEmp.salary,
      netSalary: net,
      paymentStatus: 'Paid'
    };
    setPayrollRecords(prev => [newPay, ...prev]);

    setIsAddingEmployee(false);
    // Reset
    setEmployeeForm({
      name: '',
      email: '',
      role: '',
      department: 'Engineering',
      salary: 80000,
      phone: '',
      workMode: 'Hybrid'
    });
  };

  // Run payroll pipeline
  const processFullPayroll = () => {
    setIsProcessingPayroll(true);
    setPayrollProcessingMsg('Scanning statutory updates and employee loss of pay days...');
    
    setTimeout(() => {
      setPayrollProcessingMsg('Evaluating Provident Funds and Tax Deducted at Source summaries...');
      
      setTimeout(() => {
        setPayrollProcessingMsg('Broadcasting bank-transfer ledger API coordinates. Done!');
        
        setTimeout(() => {
          setIsProcessingPayroll(false);
          setPayrollProcessingMsg('');
          setPayrollRecords(prev => prev.map(p => ({ ...p, paymentStatus: 'Paid' })));
        }, 1000);
      }, 1200);
    }, 1200);
  };

  // HR approvals for Leaves
  const handleLeaveResolution = (reqId: string, status: 'Approved' | 'Rejected') => {
    setLeaveRequests(prev => prev.map(req => {
      if (req.id === reqId) {
        // Find employee object and change status to Active/On Leave
        if (status === 'Approved') {
          setEmployees(empList => empList.map(e => e.id === req.employeeId ? { ...e, status: 'On Leave' } : e));
        }
        return { ...req, status };
      }
      return req;
    }));
  };

  // Expenses management (Admin)
  const handleExpenseResolution = (expId: string, status: 'Approved' | 'Rejected') => {
    setExpenses(prev => prev.map(e => e.id === expId ? { ...e, status } : e));
  };

  // Submit self-service clock-in success log
  const handleSelfClockIn = (time: string, method: string) => {
    // Add attendance log
    const newAT: AttendanceLog = {
      id: `AT-${400 + attendanceLogs.length + 1}`,
      employeeId: loggedInEmployee.id,
      date: new Date().toISOString().split('T')[0],
      clockIn: time,
      status: 'On-Time',
      locationSim: method
    };
    setAttendanceLogs(prev => [newAT, ...prev]);
  };

  // Submit self-service clock-out success log
  const handleSelfClockOut = (time: string, duration: string) => {
    setAttendanceLogs(prev => prev.map(log => {
      if (log.employeeId === loggedInEmployee.id && !log.clockOut) {
        return { ...log, clockOut: time, status: 'On-Time' };
      }
      return log;
    }));
  };

  // Submit a leave request (ESS)
  const handleCreateLeaveRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeaveForm.startDate || !newLeaveForm.endDate || !newLeaveForm.reason) return;

    const newReq: LeaveRequest = {
      id: `LV-${301 + leaveRequests.length + 1}`,
      employeeId: loggedInEmployee.id,
      employeeName: loggedInEmployee.name,
      employeeAvatar: loggedInEmployee.avatar,
      leaveType: newLeaveForm.type as any,
      startDate: newLeaveForm.startDate,
      endDate: newLeaveForm.endDate,
      days: Number(newLeaveForm.days) || 1,
      reason: newLeaveForm.reason,
      status: 'Pending',
      appliedDate: new Date().toISOString().split('T')[0]
    };

    setLeaveRequests(prev => [newReq, ...prev]);
    setLeaveSubmitSuccess(true);
    setNewLeaveForm({
      type: 'Casual Leave',
      startDate: '',
      endDate: '',
      reason: '',
      days: 1
    });

    setTimeout(() => setLeaveSubmitSuccess(false), 3000);
  };

  // Submit a Helpdesk ticker (ESS)
  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicketForm.title || !newTicketForm.description) return;

    const newTkt: HelpdeskTicket = {
      id: `TKT-${601 + tickets.length + 1}`,
      employeeName: loggedInEmployee.name,
      title: newTicketForm.title,
      category: newTicketForm.category,
      description: newTicketForm.description,
      status: 'Open',
      priority: newTicketForm.priority,
      date: new Date().toISOString().split('T')[0]
    };

    setTickets(prev => [newTkt, ...prev]);
    setTicketSubmitSuccess(true);
    setNewTicketForm({
      title: '',
      category: 'IT Support',
      description: '',
      priority: 'Medium'
    });

    setTimeout(() => setTicketSubmitSuccess(false), 3000);
  };

  // Submit peer support shoutout (ESS)
  const handleCreateShoutout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShoutoutForm.receiverId || !newShoutoutForm.message) return;

    const receiver = employees.find(emp => emp.id === newShoutoutForm.receiverId);
    if (!receiver) return;

    const newSht: PublicShoutout = {
      id: `FEED-${401 + shoutouts.length + 1}`,
      senderName: loggedInEmployee.name,
      senderAvatar: loggedInEmployee.avatar,
      receiverName: receiver.name,
      receiverAvatar: receiver.avatar,
      message: newShoutoutForm.message,
      badge: newShoutoutForm.badge,
      date: new Date().toISOString().split('T')[0],
      likes: 1
    };

    setShoutouts(prev => [newSht, ...prev]);
    setShoutoutSuccess(true);
    setNewShoutoutForm({
      receiverId: '',
      message: '',
      badge: 'Collaboration'
    });

    setTimeout(() => setShoutoutSuccess(false), 3000);
  };

  // Filter Employees directory lists
  const filteredEmployees = employees.filter(e => {
    const matcher = e.name.toLowerCase().includes(dirSearch.toLowerCase()) || 
                    e.role.toLowerCase().includes(dirSearch.toLowerCase()) ||
                    e.id.toLowerCase().includes(dirSearch.toLowerCase());
    const matchesDept = dirDeptFilter === 'All' || e.department === dirDeptFilter;
    return matcher && matchesDept;
  });

  // Switch actively logged in profile to explore logs variation
  const handleSwitchSessionEmployee = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const found = employees.find(emp => emp.id === selectedId);
    if (found) {
      setLoggedInEmployee(found);
    }
  };


  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-indigo-100">
      
      {/* Platform Level Header panel */}
      <header className="bg-slate-900 text-white px-6 py-3 border-b border-slate-800 flex flex-col sm:flex-row gap-3 justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <button 
            id="back-to-landing-btn"
            onClick={onExit}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" /> <span>Back to Main Site</span>
          </button>
          
          <div className="w-px h-5 bg-slate-700 hidden sm:block" />

          {/* Slogan */}
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-indigo-400 font-sans text-sm tracking-tight">EMVORA PLATFORM CONSOLE</span>
            <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-md font-mono font-bold">V1.5-SANDBOX</span>
          </div>
        </div>

        {/* Persona Pill Toggles */}
        <div className="flex items-center gap-3">
          
          {/* Active profile switch when in Employee View */}
          {roleMode === 'employee' && (
            <div id="logged-profile-switcher-panel" className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/60 px-3 py-1 rounded-lg text-xs">
              <span className="text-[10px] text-slate-400 font-medium">As Member:</span>
              <select
                value={loggedInEmployee.id}
                onChange={handleSwitchSessionEmployee}
                className="bg-transparent border-none text-white font-bold focus:outline-hidden text-xs cursor-pointer"
              >
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id} className="text-slate-900 font-medium">{emp.name} ({emp.role})</option>
                ))}
              </select>
            </div>
          )}

          <div id="role-swappers-container" className="p-0.5 bg-slate-800 rounded-xl border border-slate-700 flex">
            <button
              onClick={() => {
                setRoleMode('admin');
                setSelectedPayslipRecord(null);
              }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                roleMode === 'admin' 
                  ? 'bg-indigo-600 text-white shadow-xs' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>👑 Setup Admin</span>
            </button>
            <button
              onClick={() => {
                setRoleMode('employee');
                setSelectedPayslipRecord(null);
              }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                roleMode === 'employee' 
                  ? 'bg-indigo-600 text-white shadow-xs' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>🙋‍♂️ Employee (ESS)</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main workspace (Sidebar + Center Content) */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* SIDE BAR SECTOR */}
        <aside id="console-sidebar" className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col justify-between py-6">
          <div className="space-y-6">
            
            {/* Header segment stating active persona */}
            <div className="px-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-700">
                {roleMode === 'admin' ? (
                  <User className="w-5 h-5 text-indigo-600" />
                ) : (
                  <img src={loggedInEmployee.avatar} alt="Login profile avatar representation" className="w-10 h-10 rounded-full object-cover border border-indigo-200" referrerPolicy="no-referrer" />
                )}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 leading-tight">
                  {roleMode === 'admin' ? "Kavita Rao" : loggedInEmployee.name}
                </h4>
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest block mt-0.5">
                  {roleMode === 'admin' ? "Platform HR Admin" : loggedInEmployee.role}
                </span>
              </div>
            </div>

            {/* Admin Side Nav links */}
            {roleMode === 'admin' ? (
              <nav className="space-y-1.5 px-3">
                <button
                  onClick={() => setActiveAdminTab('dashboard')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeAdminTab === 'dashboard' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Home className="w-4 h-4" /> <span>H.R. Dashboard</span>
                </button>
                <button
                  onClick={() => setActiveAdminTab('directory')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeAdminTab === 'directory' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Users className="w-4 h-4" /> <span>Employee Directory</span>
                </button>
                <button
                  onClick={() => setActiveAdminTab('payroll')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeAdminTab === 'payroll' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="w-4 h-4" /> <span>Financial & Payroll</span>
                </button>
                <button
                  onClick={() => setActiveAdminTab('leaves')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeAdminTab === 'leaves' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Clock className="w-4 h-4" /> <span>Leaves Approval</span>
                </button>
                <button
                  onClick={() => setActiveAdminTab('ats')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeAdminTab === 'ats' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Briefcase className="w-4 h-4" /> <span>Recruitment ATS</span>
                </button>
                <button
                  onClick={() => setActiveAdminTab('expenses')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeAdminTab === 'expenses' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <DollarSign className="w-4 h-4" /> <span>Expense Audits</span>
                </button>
              </nav>
            ) : (
              // Employee Side Nav links
              <nav className="space-y-1.5 px-3">
                <button
                  onClick={() => setActiveEmployeeTab('dashboard')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeEmployeeTab === 'dashboard' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Home className="w-4 h-4" /> <span>My Hub Dashboard</span>
                </button>
                <button
                  onClick={() => setActiveEmployeeTab('leaves')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeEmployeeTab === 'leaves' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Clock className="w-4 h-4" /> <span>My Leaves Request</span>
                </button>
                <button
                  onClick={() => setActiveEmployeeTab('payslips')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeEmployeeTab === 'payslips' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="w-4 h-4" /> <span>My Pay Slips</span>
                </button>
                <button
                  onClick={() => setActiveEmployeeTab('helpdesk')}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    activeEmployeeTab === 'helpdesk' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <HelpCircle className="w-4 h-4" /> <span>Helpdesk & Queries</span>
                </button>
              </nav>
            )}

          </div>

          <div className="px-6 space-y-3.5 text-xs text-slate-400">
            <div className="p-3 bg-indigo-50 text-indigo-700 rounded-xl font-medium border border-indigo-100">
              <span className="font-bold uppercase tracking-wider text-[9px] block mb-1">Interactive Sandbox</span>
              You have loaded Emvora's fully interactive product showcase with pre-populated records. Feel free to run operations!
            </div>
          </div>
        </aside>

        {/* WORKSPACE VIEW RENDERER PANEL */}
        <main id="workspace-center" className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-7xl mx-auto space-y-8">

            {/* 1. ================== HR ADMIN PERSONA VIEWS ================== */}
            {roleMode === 'admin' ? (
              <div id="admin-workspace-pane">
                
                {/* ADMIN DASHBOARD COMPONENT */}
                {activeAdminTab === 'dashboard' && (
                  <div className="space-y-6">
                    
                    {/* Welcome Header */}
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">People Analytics Hub</h2>
                        <span className="text-xs text-slate-500 font-medium">Real-time indicators of corporate personnel, pipelines, and compliance bills.</span>
                      </div>
                      <div className="text-[11px] font-mono font-medium border border-slate-250 bg-white shadow-xs p-2.5 rounded-lg">
                        Today: <span className="font-bold text-indigo-600">June 8, 2026</span>
                      </div>
                    </div>

                    {/* Stats summary row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      
                      <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">Database Strength</span>
                        <div className="flex items-baseline gap-1.5 mt-2">
                          <span className="text-2xl font-black text-slate-800">{employees.length}</span>
                          <span className="text-[10px] text-slate-400">Active Members</span>
                        </div>
                        <span className="text-[9px] text-green-600 font-semibold block mt-1">✓ Fully onboarded contracts</span>
                      </div>

                      <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">Pending Leave Claims</span>
                        <div className="flex items-baseline gap-1.5 mt-2">
                          <span className="text-2xl font-black text-slate-800">
                            {leaveRequests.filter(l => l.status === 'Pending').length}
                          </span>
                          <span className="text-[10px] text-slate-400">Needs Response</span>
                        </div>
                        <span className="text-[9px] text-indigo-600 hover:underline cursor-pointer font-semibold block mt-1" onClick={() => setActiveAdminTab('leaves')}>
                          Review approval folder →
                        </span>
                      </div>

                      <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">Talent Recruitment Flow</span>
                        <div className="flex items-baseline gap-1.5 mt-2">
                          <span className="text-2xl font-black text-slate-800">
                            {candidates.filter(c => c.stage !== 'Hired' && c.stage !== 'Rejected').length}
                          </span>
                          <span className="text-[10px] text-slate-400">Candidates in Track</span>
                        </div>
                        <span className="text-[9px] text-slate-400 font-semibold block mt-1">Hired 1 member this week</span>
                      </div>

                      <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-xs">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block font-mono">Pending Expense Claims</span>
                        <div className="flex items-baseline gap-1.5 mt-2">
                          <span className="text-2xl font-black text-slate-800">
                            {expenses.filter(e => e.status === 'Pending').length}
                          </span>
                          <span className="text-[10px] text-slate-400">Awaiting Audits</span>
                        </div>
                        <span className="text-[9px] text-indigo-600 hover:underline cursor-pointer font-semibold block mt-1" onClick={() => setActiveAdminTab('expenses')}>
                          Open expense logs
                        </span>
                      </div>

                    </div>

                    {/* Integrated Recharts displays */}
                    <AnalyticsCharts employees={employees} candidates={candidates} attendance={attendanceLogs} />

                    {/* Announcements & Social Feed */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                      
                      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-sm font-bold text-slate-900">Corporate Announcements</h3>
                          <span className="text-[9px] font-bold text-indigo-600 uppercase font-mono tracking-wider">Broadcasting Active</span>
                        </div>
                        <div className="space-y-4">
                          {announcements.map((ann) => (
                            <div key={ann.id} className="border-b border-slate-100 last:border-none pb-4 last:pb-0">
                              <div className="flex justify-between text-[10px] text-slate-400 pb-1 font-mono">
                                <span>Category: {ann.category}</span>
                                <span>{ann.date}</span>
                              </div>
                              <h4 className="text-xs font-bold text-slate-800">{ann.title}</h4>
                              <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{ann.content}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-sm font-bold text-slate-900">Peer Praise & Activity Stream</h3>
                          <span className="text-[9px] font-bold text-teal-600 uppercase font-mono">Kudos Feed</span>
                        </div>
                        <div className="space-y-3.5">
                          {shoutouts.slice(0, 3).map((sht) => (
                            <div key={sht.id} className="bg-slate-50/70 border border-slate-100 p-3.5 rounded-xl space-y-2">
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-1.5">
                                  <img src={sht.senderAvatar} alt="shoutout sender profile representation" className="w-5 h-5 rounded-full object-cover" width="16" referrerPolicy="no-referrer" />
                                  <span className="text-[10px] font-bold text-slate-700">{sht.senderName}</span>
                                  <span className="text-[9px] text-slate-400">praised</span>
                                  <img src={sht.receiverAvatar} alt="shoutout receiver profile representation" className="w-5 h-5 rounded-full object-cover" width="16" referrerPolicy="no-referrer" />
                                  <span className="text-[10px] font-bold text-slate-700">{sht.receiverName}</span>
                                </div>
                                <span className="inline-flex gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                                  🏆 {sht.badge}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 leading-relaxed font-sans font-medium">
                                "{sht.message}"
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>

                  </div>
                )}

                {/* EMPLOYEE DIRECTORY COMPONENT */}
                {activeAdminTab === 'directory' && (
                  <div className="space-y-6">
                    
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">Internal Employee Registry</h2>
                        <span className="text-xs text-slate-500 font-medium">Verify employee roles, contact parameters, salaries, and current status structures.</span>
                      </div>
                      <div className="flex gap-2.5 w-full sm:w-auto">
                        <div className="relative">
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input 
                            type="text" 
                            placeholder="Search name, code..."
                            value={dirSearch}
                            onChange={(e) => setDirSearch(e.target.value)}
                            className="pl-9 pr-4 py-2 border border-slate-200 bg-white rounded-lg text-xs focus:outline-hidden focus:border-indigo-500 w-full sm:w-[180px]"
                          />
                        </div>
                        <select 
                          value={dirDeptFilter}
                          onChange={(e) => setDirDeptFilter(e.target.value)}
                          className="border border-slate-200 bg-white rounded-lg text-xs px-2.5 py-2 font-medium focus:outline-hidden text-slate-600"
                        >
                          <option value="All">All Departments</option>
                          <option value="Engineering">Engineering</option>
                          <option value="Sales">Sales</option>
                          <option value="HR">HR</option>
                          <option value="Marketing">Marketing</option>
                          <option value="Operations">Operations</option>
                          <option value="Finance">Finance</option>
                        </select>
                        <button
                          onClick={() => setIsAddingEmployee(true)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-transform flex items-center gap-1.5"
                        >
                          <Plus className="w-4 h-4" /> <span>Onboard Employee</span>
                        </button>
                      </div>
                    </div>

                    {/* Table of Employees */}
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                      <table className="w-full text-left font-sans border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="px-6 py-3.5">Employee Name & Code</th>
                            <th className="px-6 py-3.5">Role Designation</th>
                            <th className="px-6 py-3.5">Department</th>
                            <th className="px-6 py-3.5">Work Setting</th>
                            <th className="px-6 py-3.5">Compensation</th>
                            <th className="px-6 py-3.5">System Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-xs">
                          {filteredEmployees.map((emp) => (
                            <tr 
                              key={emp.id}
                              onClick={() => setSelectedDirectoryEmployee(emp)}
                              className="hover:bg-indigo-50/30 cursor-pointer transition-colors"
                            >
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <img src={emp.avatar} alt="Employee avatar visual representation" className="w-9 h-9 rounded-full object-cover border border-slate-200" referrerPolicy="no-referrer" />
                                  <div className="text-left font-sans">
                                    <span className="font-extrabold text-slate-900 block">{emp.name}</span>
                                    <span className="text-[10px] font-semibold text-slate-400 font-mono block mt-0.5">{emp.id}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 font-semibold text-slate-650">{emp.role}</td>
                              <td className="px-6 py-4">
                                <span className="px-2.5 py-1 bg-slate-100 rounded-md text-[11px] font-bold text-slate-600">
                                  {emp.department}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-medium text-slate-500">{emp.workMode}</td>
                              <td className="px-6 py-4 font-mono font-bold text-slate-800">₹{emp.salary.toLocaleString('en-IN')}/yr</td>
                              <td className="px-6 py-4">
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                  emp.status === 'Active' ? 'bg-green-50 text-green-700 font-bold border border-green-200' :
                                  emp.status === 'On Leave' ? 'bg-yellow-50 text-yellow-700 font-bold border border-yellow-250' : 'bg-red-50 text-red-700'
                                }`}>
                                  {emp.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {filteredEmployees.length === 0 && (
                        <div className="p-8 text-center border-t border-slate-150">
                          <span className="text-xs text-slate-500 font-medium">No matching employee records detected.</span>
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* THE FINANCIAL & PAYROLL PROCESSING COMPONENT */}
                {activeAdminTab === 'payroll' && (
                  <div className="space-y-6">
                    
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">SaaS Financial & Payroll Console</h2>
                        <span className="text-xs text-slate-500 font-medium">Verify employee tax brackets, PF reserves, deducts, and transfer active pay slips.</span>
                      </div>
                      <div className="flex gap-2.5">
                        <button
                          onClick={processFullPayroll}
                          disabled={isProcessingPayroll}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5"
                        >
                          <Check className="w-4 h-4" /> 
                          <span>{isProcessingPayroll ? 'Processing...' : 'Run & Approve May Payroll'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Payroll loading / info alert */}
                    {payrollProcessingMsg && (
                      <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-2.5 text-indigo-700 text-xs font-semibold animate-pulse">
                        <div className="w-2.5 h-2.5 bg-indigo-600 rounded-full animate-ping" />
                        <span>{payrollProcessingMsg}</span>
                      </div>
                    )}

                    {/* Ledger list */}
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                      <table className="w-full text-left font-sans border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="px-6 py-3.5">Employee Name</th>
                            <th className="px-6 py-3.5">Gross Base (₹)</th>
                            <th className="px-6 py-3.5">Basic + HRA (₹)</th>
                            <th className="px-6 py-3.5">PF Deduct (₹)</th>
                            <th className="px-6 py-3.5">Tax (TDS) (₹)</th>
                            <th className="px-6 py-3.5">Net Disbursed (₹)</th>
                            <th className="px-6 py-3.5">Transfer Status</th>
                            <th className="px-6 py-3.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-xs text-slate-650">
                          {payrollRecords.map((pay) => {
                            const empObj = employees.find(e => e.id === pay.employeeId) || employees[0];
                            return (
                              <tr key={pay.employeeId} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-bold text-slate-900">
                                  {pay.employeeName}
                                  <span className="block text-[9px] font-semibold text-slate-400 font-mono mt-0.5">{pay.employeeId} ({pay.department})</span>
                                  <span className="block text-[8px] text-indigo-600 font-bold font-sans mt-0.5">PAN: ALHPXXXXXA</span>
                                </td>
                                <td className="px-6 py-4 font-mono font-bold">₹{pay.grossSalary.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-3.5 font-mono">₹{pay.basicSalary.toLocaleString('en-IN')} + ₹{pay.hra.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4 font-mono text-red-650 font-medium">-₹{pay.pfDeduction.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4 font-mono text-red-650 font-medium">-₹{pay.taxDeduction.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4 font-mono font-bold text-indigo-750">₹{pay.netSalary.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4">
                                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                    pay.paymentStatus === 'Paid' ? 'bg-green-50 text-green-700 border border-green-200' :
                                    pay.paymentStatus === 'Processing' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse' : 'bg-red-50 text-red-700'
                                  }`}>
                                    {pay.paymentStatus}
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <button
                                    onClick={() => {
                                      setSelectedPayslipRecord(pay);
                                      setSelectedPayslipEmployee(empObj);
                                    }}
                                    className="px-3 py-1.5 hover:bg-slate-100 text-indigo-600 hover:text-indigo-800 font-bold text-xs rounded-lg border border-slate-200"
                                  >
                                    View Slip
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                  </div>
                )}

                {/* LEAVES & PRESENCE MANAGEMENT INBOX (ADMIN) */}
                {activeAdminTab === 'leaves' && (
                  <div className="space-y-6">
                    
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">Leaves Management & Approvals</h2>
                      <span className="text-xs text-slate-500 font-medium">Review vacation details, casualty log limits, and medical reasons of personnel.</span>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                      
                      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                        <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                          <h3 className="text-sm font-bold text-slate-900">Pending Leave Proposals</h3>
                          <span className="text-[10px] font-bold text-indigo-650 uppercase font-mono tracking-wider">Awaiting Audit</span>
                        </div>

                        <div className="space-y-4">
                          {leaveRequests.filter(req => req.status === 'Pending').map((req) => (
                            <div key={req.id} className="bg-slate-50/70 border border-slate-200 p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="flex items-center gap-3">
                                <img src={req.employeeAvatar} alt="Employee visual avatar" className="w-10 h-10 rounded-full object-cover border border-slate-200" referrerPolicy="no-referrer" />
                                <div className="text-left font-sans">
                                  <div className="flex items-center gap-2">
                                    <span className="font-extrabold text-slate-900 text-xs">{req.employeeName}</span>
                                    <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-[9px] font-bold text-indigo-700 rounded-md">{req.leaveType}</span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 block mt-0.5">Applied: {req.appliedDate} | Duration: <span className="font-bold text-slate-600">{req.startDate} to {req.endDate} ({req.days} days)</span></span>
                                  <p className="text-xs italic text-slate-500 font-medium mt-1.5 font-sans leading-relaxed">"Reason: {req.reason}"</p>
                                </div>
                              </div>
                              <div className="flex gap-2 text-xs">
                                <button
                                  onClick={() => handleLeaveResolution(req.id, 'Rejected')}
                                  className="px-3.5 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg font-bold"
                                >
                                  Reject request
                                </button>
                                <button
                                  onClick={() => handleLeaveResolution(req.id, 'Approved')}
                                  className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-xs"
                                >
                                  Approve request
                                </button>
                              </div>
                            </div>
                          ))}

                          {leaveRequests.filter(req => req.status === 'Pending').length === 0 && (
                            <div className="text-center p-6 text-slate-400">
                              <span className="text-xs font-medium">All leave queues cleared! No pending actions.</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Leaves Ledger History */}
                      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100 animate-fade">
                          <h3 className="text-sm font-bold text-slate-900">Historic Leave Log Ledger (Total)</h3>
                          <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Archived logs</span>
                        </div>
                        <div className="space-y-3.5">
                          {leaveRequests.filter(req => req.status !== 'Pending').map((req) => (
                            <div key={req.id} className="flex justify-between items-center text-xs text-slate-500 py-1.5 last:border-b-0 border-b border-slate-50">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-800">{req.employeeName}</span>
                                <span className="text-[10.5px] font-semibold">({req.leaveType})</span>
                                <span className="text-[10.5px] font-mono">{req.startDate} ({req.days} days)</span>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                req.status === 'Approved' ? 'bg-green-50 text-green-700 font-bold border border-green-200' : 'bg-red-50 text-red-700 border border-red-150'
                              }`}>
                                {req.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>

                  </div>
                )}

                {/* THE INTEGRATED CANDIDATES ATS PLATFORM */}
                {activeAdminTab === 'ats' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">Recruitment ATS & Acquire Suite</h2>
                      <span className="text-xs text-slate-500 font-medium">Manage corporate pipelines, schedule screening logs, and transition candidates.</span>
                    </div>

                    <CandidateATS 
                      candidates={candidates} 
                      onUpdateCandidate={handleUpdateCandidate} 
                      onAddCandidate={handleAddCandidate} 
                    />
                  </div>
                )}

                {/* EXPENSES AUDITING SECTION */}
                {activeAdminTab === 'expenses' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">Internal Expense Audit Claims</h2>
                      <span className="text-xs text-slate-500 font-medium">Review cab receipts, broadband reimbursements, and office supplies bills.</span>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-left font-sans border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="px-6 py-3.5">Employee Name</th>
                            <th className="px-6 py-3.5">Claim Details</th>
                            <th className="px-6 py-3.5">Category</th>
                            <th className="px-6 py-3.5">Claim Date</th>
                            <th className="px-6 py-3.5">Sum Invoice</th>
                            <th className="px-6 py-3.5">Audit States</th>
                            <th className="px-6 py-3.5 text-right">Decide</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-xs">
                          {expenses.map((exp) => (
                            <tr key={exp.id} className="hover:bg-slate-50">
                              <td className="px-6 py-4 font-bold text-slate-900">{exp.employeeName}</td>
                              <td className="px-6 py-4 font-medium text-slate-700">{exp.title}</td>
                              <td className="px-6 py-4">
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10.5px] font-bold">{exp.category}</span>
                              </td>
                              <td className="px-6 py-4 font-mono text-slate-500">{exp.date}</td>
                              <td className="px-6 py-4 font-mono font-bold text-slate-850">₹{exp.amount.toLocaleString('en-IN')}</td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  exp.status === 'Approved' ? 'bg-green-50 text-green-700 font-bold border border-green-250' :
                                  exp.status === 'Pending' ? 'bg-amber-50 text-amber-700 font-bold border border-amber-200 animate-pulse' : 'bg-red-50 text-red-700'
                                }`}>
                                  {exp.status}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                {exp.status === 'Pending' ? (
                                  <div className="flex gap-1 justify-end">
                                    <button
                                      onClick={() => handleExpenseResolution(exp.id, 'Rejected')}
                                      className="p-1 text-red-600 hover:bg-red-50 border border-red-200 rounded font-bold"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() => handleExpenseResolution(exp.id, 'Approved')}
                                      className="p-1 px-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded"
                                    >
                                      Approve
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-400 font-medium italic">Evaluated</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            ) : (
              // 2. ================== EMPLOYEE SELF SERVICE (ESS) VIEWS ==================
              <div id="employee-workspace-pane">
                
                {/* MY HUB / ESS DASHBOARD */}
                {activeEmployeeTab === 'dashboard' && (
                  <div className="space-y-6">
                    
                    {/* Welcome Header */}
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">My Employee Service Desk</h2>
                        <span className="text-xs text-slate-500 font-medium">Verify your daily active schedules, download payslips, file IT tickets, or appreciate coworkers.</span>
                      </div>
                      <div className="text-[11px] font-semibold border border-slate-200 bg-white shadow-xs px-3.5 py-2.5 rounded-xl">
                        Designation: <span className="font-extrabold text-indigo-600">{loggedInEmployee.role} ({loggedInEmployee.department})</span>
                      </div>
                    </div>

                    {/* Dashboard grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                      
                      {/* Left Side: Clocking widget & mini indicators */}
                      <div className="lg:col-span-4 space-y-6">
                        
                        {/* Clock In-Out Visual Widget component */}
                        <ClockWidget 
                          employeeName={loggedInEmployee.name} 
                          onClockInSuccess={handleSelfClockIn}
                          onClockOutSuccess={handleSelfClockOut}
                        />

                        {/* Balance Leave Card widget */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                          <h4 className="text-xs font-bold text-slate-900 border-b border-indigo-50 pb-2 uppercase tracking-wider block">My Remaining Leave Balance</h4>
                          <div className="grid grid-cols-3 gap-2.5 text-center">
                            <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-xl">
                              <span className="text-[10px] text-slate-500 font-medium block">Casual</span>
                              <span className="text-base font-extrabold text-indigo-700 block font-mono">4.5</span>
                            </div>
                            <div className="p-2 bg-purple-50 border border-purple-100 rounded-xl">
                              <span className="text-[10px] text-slate-500 font-medium block">Sick</span>
                              <span className="text-base font-extrabold text-purple-700 block font-mono">5.0</span>
                            </div>
                            <div className="p-2 bg-teal-50 border border-teal-100 rounded-xl">
                              <span className="text-[10px] text-slate-500 font-medium block">Privilege</span>
                              <span className="text-base font-extrabold text-teal-700 block font-mono">12.0</span>
                            </div>
                          </div>
                        </div>

                      </div>

                      {/* Right Side: Praise panel, feed and announcements */}
                      <div className="lg:col-span-8 space-y-6">
                        
                        {/* Interactive Submit peer feedback form */}
                        <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                          <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-bold text-slate-900">Praise a Colleague - Reward Shoutout</h3>
                            <span className="text-[9px] font-bold text-purple-700 uppercase font-mono flex items-center gap-1"><Sparkles className="w-3 h-3 animate-spin" /> Send Praise</span>
                          </div>

                          <form onSubmit={handleCreateShoutout} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <label className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider block">Select Coworker</label>
                                <select
                                  value={newShoutoutForm.receiverId}
                                  onChange={(e) => setNewFormState => setNewShoutoutForm({ ...newShoutoutForm, receiverId: e.target.value })}
                                  className="w-full text-xs border border-slate-200 rounded-lg p-2.5 bg-white focus:outline-hidden text-slate-705 font-medium"
                                  required
                                >
                                  <option value="">-- Choose coworker --</option>
                                  {employees.filter(e => e.id !== loggedInEmployee.id).map(emp => (
                                    <option key={emp.id} value={emp.id}>{emp.name} ({emp.role})</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider block">Kudos Category Tag</label>
                                <select
                                  value={newShoutoutForm.badge}
                                  onChange={(e) => setNewShoutoutForm({ ...newShoutoutForm, badge: e.target.value as any })}
                                  className="w-full text-xs border border-slate-200 rounded-lg p-2.5 bg-white focus:outline-hidden text-slate-705 font-medium"
                                >
                                  <option value="Collaboration">Collaboration</option>
                                  <option value="Customer Obsession">Customer Obsession</option>
                                  <option value="Excellence">Excellence</option>
                                  <option value="Humility">Humility</option>
                                  <option value="Bias for Action">Bias for Action</option>
                                </select>
                              </div>
                            </div>
                            
                            <div className="space-y-1">
                              <label className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider block">Message of Appreciation</label>
                              <textarea
                                rows={2}
                                value={newShoutoutForm.message}
                                onChange={(e) => setNewShoutoutForm({ ...newShoutoutForm, message: e.target.value })}
                                placeholder="Describe specifically what outstanding work they processed or how they supported the squad..."
                                className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-hidden focus:border-indigo-500"
                                required
                              />
                            </div>

                            <div className="flex justify-between items-center pt-1.5">
                              {shoutoutSuccess ? (
                                <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">✓ Appreciation published on corporate feed!</span>
                              ) : (
                                <span className="text-[10px] text-slate-400">Praise tag appears live instantly in Admin and peer streams.</span>
                              )}
                              <button
                                type="submit"
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-sm"
                              >
                                <Send className="w-3.5 h-3.5" /> <span>Send Kudos shoutout</span>
                              </button>
                            </div>
                          </form>
                        </div>

                        {/* Core announcements listing */}
                        <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                          <h3 className="text-sm font-bold text-slate-900 border-b border-indigo-50 pb-2 mb-4">Organizational Broadcasting Hub</h3>
                          <div className="space-y-4">
                            {announcements.map((ann) => (
                              <div key={ann.id} className="border-b border-slate-50 last:border-b-0 pb-3 last:pb-0">
                                <div className="flex justify-between text-[9px] text-slate-400 font-mono pb-1 font-semibold">
                                  <span>Author: {ann.author.name} ({ann.author.role})</span>
                                  <span>{ann.date}</span>
                                </div>
                                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                  {ann.title}
                                </h4>
                                <p className="text-xs text-slate-500 leading-relaxed max-w-full font-medium font-sans mt-1">
                                  {ann.content}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                      </div>

                    </div>

                  </div>
                )}

                {/* MY LEAVES REQUEST TABLE & SUBMIT FORM */}
                {activeEmployeeTab === 'leaves' && (
                  <div className="space-y-6">
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      
                      {/* Submitting Forms */}
                      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm self-start">
                        <h3 className="text-sm font-bold text-slate-900 border-b border-indigo-50 pb-2 mb-4">Request a New Leave</h3>
                        
                        <form onSubmit={handleCreateLeaveRequest} className="space-y-4 text-xs font-medium">
                          
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Category</label>
                            <select
                              value={newLeaveForm.type}
                              onChange={(e) => setNewLeaveForm({ ...newLeaveForm, type: e.target.value })}
                              className="w-full border border-slate-200 rounded-lg p-2.5 bg-white text-xs select-none focus:outline-hidden"
                            >
                              <option value="Casual Leave">Casual Leave</option>
                              <option value="Sick Leave">Sick Leave</option>
                              <option value="Privilege Leave">Privilege Leave</option>
                              <option value="Maternity Leave">Maternity Leave</option>
                              <option value="Unpaid Leave">Unpaid Leave</option>
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Start Date</label>
                              <input
                                type="date"
                                required
                                value={newLeaveForm.startDate}
                                onChange={(e) => setNewLeaveForm({ ...newLeaveForm, startDate: e.target.value })}
                                className="w-full border border-slate-200 rounded-lg p-2 focus:outline-hidden text-xs"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">End Date</label>
                              <input
                                type="date"
                                required
                                value={newLeaveForm.endDate}
                                onChange={(e) => setNewLeaveForm({ ...newLeaveForm, endDate: e.target.value })}
                                className="w-full border border-slate-200 rounded-lg p-2 focus:outline-hidden text-xs"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Calculation days estimate</label>
                            <input
                              type="number"
                              min="1"
                              max="30"
                              value={newLeaveForm.days}
                              onChange={(e) => setNewLeaveForm({ ...newLeaveForm, days: Number(e.target.value) })}
                              className="w-full border border-slate-200 rounded-lg p-2 focus:outline-hidden text-xs font-mono"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Reason & Backfill Arrangements</label>
                            <textarea
                              rows={3}
                              required
                              value={newLeaveForm.reason}
                              onChange={(e) => setNewLeaveForm({ ...newLeaveForm, reason: e.target.value })}
                              placeholder="Provide deep details or contact fallback support backup during leave duration..."
                              className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-indigo-500 text-xs"
                            />
                          </div>

                          <div className="pt-2">
                            {leaveSubmitSuccess && (
                              <span className="text-[10px] text-green-600 font-bold block mb-2">✓ Application submitted to HR pipeline!</span>
                            )}
                            <button
                              type="submit"
                              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors"
                            >
                              Submit Leave request
                            </button>
                          </div>

                        </form>
                      </div>

                      {/* Presence list */}
                      <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                          <h3 className="text-sm font-bold text-slate-900 border-b border-indigo-50 pb-2 mb-4">Leave Application Tracker (Status)</h3>
                          
                          <div className="space-y-4">
                            {leaveRequests.filter(l => l.employeeId === loggedInEmployee.id).map((req) => (
                              <div key={req.id} className="bg-slate-50/70 border border-slate-200 p-4 rounded-xl flex items-center justify-between text-xs">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-extrabold text-slate-800">{req.leaveType}</span>
                                    <span className="text-[9.5px] font-mono text-slate-400 font-semibold">{req.days} Day(s)</span>
                                  </div>
                                  <span className="text-[10.5px] text-slate-500 block mt-1">Duration: {req.startDate} to {req.endDate}</span>
                                  <p className="text-[11px] text-slate-400 italic font-sans mt-1.5">"Reason: {req.reason}"</p>
                                </div>
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold ${
                                  req.status === 'Approved' ? 'bg-green-50 text-green-700 border border-green-200' :
                                  req.status === 'Pending' ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse' : 'bg-red-50 text-red-700 border border-red-150'
                                }`}>
                                  {req.status}
                                </span>
                              </div>
                            ))}

                            {leaveRequests.filter(l => l.employeeId === loggedInEmployee.id).length === 0 && (
                              <div className="text-center p-6 text-slate-400">
                                <span className="text-xs">No leave requests logged to your dashboard yet.</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                    </div>

                  </div>
                )}

                {/* MY PAYSLIPS PORTLET (ESS) */}
                {activeEmployeeTab === 'payslips' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight text-left">My Historic Pay Slips</h2>
                      <span className="text-xs text-slate-500 font-medium">Instantly access tax invoice ledgers and download detailed monthly reports.</span>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                      <table className="w-full text-left font-sans border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="px-6 py-3.5">Month Period</th>
                            <th className="px-6 py-3.5">Gross Base (₹)</th>
                            <th className="px-6 py-3.5">Deducts (₹)</th>
                            <th className="px-6 py-3.5">Net Disbursed (₹)</th>
                            <th className="px-6 py-3.5">Payment Ref ID</th>
                            <th className="px-6 py-3.5 text-right">Receipt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 text-xs text-slate-650">
                          {payrollRecords.filter(p => p.employeeId === loggedInEmployee.id).map((pay) => {
                            const payslipBonus = 2500;
                            const payslipPT = 200;
                            const totalDeductions = pay.pfDeduction + pay.taxDeduction + payslipPT;
                            const totalNetDisbursed = pay.grossSalary + payslipBonus - totalDeductions;
                            return (
                              <tr key={pay.employeeId} className="hover:bg-slate-50/50">
                                <td className="px-6 py-4 font-extrabold text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400" /> May 2026</td>
                                <td className="px-6 py-4 font-mono font-bold">₹{pay.grossSalary.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4 font-mono text-red-600">-₹{totalDeductions.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4 font-mono font-black text-indigo-700">₹{totalNetDisbursed.toLocaleString('en-IN')}</td>
                                <td className="px-6 py-4 font-mono text-slate-400">TXN-0091-LAB-MAY</td>
                                <td className="px-6 py-4 text-right">
                                  <button
                                    onClick={() => {
                                      setSelectedPayslipRecord(pay);
                                      setSelectedPayslipEmployee(loggedInEmployee);
                                    }}
                                    className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 ml-auto border border-indigo-100"
                                  >
                                    View Payslip
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                  </div>
                )}

                {/* MY HELPDESK & IT SUPPORT LOGS (ESS) */}
                {activeEmployeeTab === 'helpdesk' && (
                  <div className="space-y-6">
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      
                      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm self-start">
                        <h3 className="text-sm font-bold text-slate-900 border-b border-indigo-50 pb-2 mb-4">File a Support Query</h3>
                        
                        <form onSubmit={handleCreateTicket} className="space-y-4 text-xs font-medium">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Query Title</label>
                            <input
                              type="text"
                              required
                              placeholder="e.g. Broken office monitors or Payroll mismatch"
                              value={newTicketForm.title}
                              onChange={(e) => setNewTicketForm({ ...newTicketForm, title: e.target.value })}
                              className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden text-xs font-semibold"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Department Category</label>
                              <select
                                value={newTicketForm.category}
                                onChange={(e) => setNewTicketForm({ ...newTicketForm, category: e.target.value as any })}
                                className="w-full border border-slate-200 bg-white p-2 text-xs rounded-lg focus:outline-hidden focus:border-indigo-500"
                              >
                                <option value="IT Support">IT Support</option>
                                <option value="Payroll">Payroll</option>
                                <option value="HR Query">HR Query</option>
                                <option value="Admin">Admin</option>
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Safety Priority</label>
                              <select
                                value={newTicketForm.priority}
                                onChange={(e) => setNewTicketForm({ ...newTicketForm, priority: e.target.value as any })}
                                className="w-full border border-slate-200 bg-white p-2 text-xs rounded-lg focus:outline-hidden focus:border-indigo-500"
                              >
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                              </select>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Describe issues specifically</label>
                            <textarea
                              rows={4}
                              required
                              value={newTicketForm.description}
                              onChange={(e) => setNewTicketForm({ ...newTicketForm, description: e.target.value })}
                              placeholder="Describe query context explicitly. Back up numbers or configurations if appropriate..."
                              className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden text-xs"
                            />
                          </div>

                          <div className="pt-1.5">
                            {ticketSubmitSuccess && (
                              <span className="text-[10px] text-green-600 font-bold block mb-2">✓ Support ticket registered! ID generated.</span>
                            )}
                            <button
                              type="submit"
                              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs font-sans transition-colors"
                            >
                              File Ticket
                            </button>
                          </div>
                        </form>
                      </div>

                      {/* Ticket listing */}
                      <div className="lg:col-span-2 space-y-4">
                        <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
                          <h3 className="text-sm font-bold text-slate-900 border-b border-indigo-50 pb-2 mb-4">My Resolution Tickets (Support Desk)</h3>
                          <div className="space-y-4">
                            {tickets.filter(t => t.employeeName === loggedInEmployee.name).map((tkt) => (
                              <div key={tkt.id} className="bg-slate-50/70 border border-slate-200 p-4 rounded-xl text-xs space-y-2">
                                <div className="flex justify-between items-center text-[10px]">
                                  <span className="font-bold text-slate-400 font-mono">TICKET REF: {tkt.id}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                                    tkt.status === 'Resolved' ? 'bg-green-50 text-green-700 border border-green-200' :
                                    tkt.status === 'In Progress' ? 'bg-indigo-50 text-indigo-700 border border-indigo-150 animate-pulse' : 'bg-slate-200 text-slate-650'
                                  }`}>
                                    {tkt.status}
                                  </span>
                                </div>
                                <h4 className="text-xs font-bold text-slate-800">{tkt.title}</h4>
                                <p className="text-xs text-slate-500 leading-normal">{tkt.description}</p>
                                <div className="flex justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-100 italic">
                                  <span>Priority: {tkt.priority} | Dept: {tkt.category}</span>
                                  <span>Filed on: {tkt.date}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                    </div>

                  </div>
                )}

              </div>
            )}

          </div>
        </main>

      </div>

      {/* --- FLOATING MODALS DETAILED OVERLAYS --- */}

      {/* Global Payslip Receipt view Modal overlay */}
      {selectedPayslipRecord && selectedPayslipEmployee && (
        <PayslipModal 
          record={selectedPayslipRecord}
          employee={selectedPayslipEmployee}
          onClose={() => {
            setSelectedPayslipRecord(null);
            setSelectedPayslipEmployee(null);
          }}
        />
      )}

      {/* Directory individual details popup drawer */}
      <AnimatePresence>
        {selectedDirectoryEmployee && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-left"
            >
              <div className="flex justify-between items-center bg-slate-50 px-6 py-4 border-b border-indigo-50">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-widest block">Executive Profile Dossier</span>
                <button onClick={() => setSelectedDirectoryEmployee(null)} className="p-1 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                
                <div className="flex items-center gap-4">
                  <img src={selectedDirectoryEmployee.avatar} alt="Dossier employee visual" className="w-[70px] h-[70px] rounded-full object-cover border-2 border-indigo-600 shadow-md" referrerPolicy="no-referrer" />
                  <div className="text-left">
                    <h3 className="text-base font-extrabold text-slate-900 leading-snug">{selectedDirectoryEmployee.name}</h3>
                    <span className="text-xs text-indigo-750 font-bold block">{selectedDirectoryEmployee.role}</span>
                    <span className="text-[10px] font-mono text-slate-400 block uppercase font-medium mt-1">ID Code: {selectedDirectoryEmployee.id}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs border-y border-slate-100 py-4 font-medium">
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Email Contact</span>
                    <span className="text-slate-750 font-mono">{selectedDirectoryEmployee.email}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Phone Credentials</span>
                    <span className="text-slate-750 font-mono">{selectedDirectoryEmployee.phone}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Business Stream</span>
                    <span className="text-slate-750 font-sans">{selectedDirectoryEmployee.department}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Work Strategy</span>
                    <span className="text-slate-750 font-sans">{selectedDirectoryEmployee.workMode}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Joined Date</span>
                    <span className="text-slate-750 font-sans">{selectedDirectoryEmployee.joinedDate}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block uppercase">Gross Base (₹/Yr)</span>
                    <span className="text-slate-750 font-mono font-bold">₹{selectedDirectoryEmployee.salary.toLocaleString('en-IN')}</span>
                  </div>
                </div>

                <div className="pt-2 text-xs">
                  <button
                    onClick={() => {
                      const payrollItem = payrollRecords.find(p => p.employeeId === selectedDirectoryEmployee.id);
                      if (payrollItem) {
                        setSelectedPayslipRecord(payrollItem);
                        setSelectedPayslipEmployee(selectedDirectoryEmployee);
                      }
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs transition-colors text-center block"
                  >
                    View Active Monthly Payslip Receipt
                  </button>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Onboard employee Form Slideout Modal */}
      <AnimatePresence>
        {isAddingEmployee && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-left"
            >
              <div className="flex justify-between items-center bg-slate-50 px-6 py-4 border-b border-indigo-50">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-widest block">Onboard New Team Member</span>
                <button onClick={() => setIsAddingEmployee(false)} className="p-1 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateEmployee} className="p-6 space-y-4 text-xs font-medium text-slate-600">
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Rahul Sen"
                      value={employeeForm.name}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Corporate Email</label>
                    <input
                      type="email"
                      required
                      placeholder="rahul.sen@emvora.co"
                      value={employeeForm.email}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Role Designation</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Senior Frontend Specialist"
                      value={employeeForm.role}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Annual Package (INR / ₹)</label>
                    <input
                      type="number"
                      required
                      min="1000"
                      value={employeeForm.salary}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, salary: Number(e.target.value) })}
                      className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Department Category</label>
                    <select
                      value={employeeForm.department}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, department: e.target.value as any })}
                      className="w-full border border-slate-200 bg-white p-2.5 rounded-lg focus:outline-hidden"
                    >
                      <option value="Engineering">Engineering</option>
                      <option value="Sales">Sales</option>
                      <option value="HR">HR</option>
                      <option value="Marketing">Marketing</option>
                      <option value="Operations">Operations</option>
                      <option value="Finance">Finance</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Work Strategy setting</label>
                    <select
                      value={employeeForm.workMode}
                      onChange={(e) => setEmployeeForm({ ...employeeForm, workMode: e.target.value as any })}
                      className="w-full border border-slate-200 bg-white p-2.5 rounded-lg focus:outline-hidden font-sans"
                    >
                      <option value="Hybrid">Hybrid</option>
                      <option value="Remote">Remote</option>
                      <option value="On-site">On-site</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Mobile Contact Credentials</label>
                  <input
                    type="text"
                    placeholder="+91 91234 11223"
                    value={employeeForm.phone}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-hidden focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsAddingEmployee(false)}
                    className="px-4 py-2 border border-slate-200 hover:bg-slate-50 font-bold rounded-lg text-slate-600"
                  >
                    Discard Form
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm"
                  >
                    Finish Registration
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
