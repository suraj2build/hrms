import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Briefcase,
  Plus,
  Search,
  ChevronRight,
  ChevronLeft,
  X,
  FileText,
  Clock,
  Sparkles,
  Phone,
  Mail,
  HelpCircle,
  ThumbsUp,
  Sliders,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { Candidate } from '../types';

interface CandidateATSProps {
  candidates: Candidate[];
  onUpdateCandidate: (updated: Candidate) => void;
  onAddCandidate: (newCandidate: Candidate) => void;
}

const STAGES = ['Applied', 'Screening', 'Interview', 'Offered', 'Hired', 'Rejected'] as const;

export default function CandidateATS({ candidates, onUpdateCandidate, onAddCandidate }: CandidateATSProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('All');
  const [isAddingCandidate, setIsAddingCandidate] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);

  // Form states for new candidates
  const [newForm, setNewForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'Fullstack Node & React Developer',
    experience: '2 Years',
    score: 80,
    notes: ''
  });

  // Filter list
  const filteredCandidates = candidates.filter(cand => {
    const matchesSearch = cand.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          cand.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          cand.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = filterRole === 'All' || cand.role === filterRole;
    return matchesSearch && matchesRole;
  });

  // Unique roles for the filter dropdown
  const uniqueRoles = ['All', ...Array.from(new Set(candidates.map(c => c.role)))];

  // Stage move handler
  const transitionStage = (cand: Candidate, direction: 'forward' | 'backward') => {
    const currentIndex = STAGES.indexOf(cand.stage as any);
    let nextIndex = currentIndex;
    
    if (direction === 'forward' && currentIndex < STAGES.length - 1) {
      nextIndex = currentIndex + 1;
    } else if (direction === 'backward' && currentIndex > 0) {
      nextIndex = currentIndex - 1;
    }

    if (nextIndex !== currentIndex) {
      const updated = { ...cand, stage: STAGES[nextIndex] };
      onUpdateCandidate(updated);
      if (selectedCandidate?.id === cand.id) {
        setSelectedCandidate(updated);
      }
    }
  };

  const handleCreateApplicant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.name || !newForm.email) return;

    const newCand: Candidate = {
      id: `CAN-${Math.floor(100 + Math.random() * 900)}`,
      name: newForm.name,
      email: newForm.email,
      phone: newForm.phone || '+91 XXXXX XXXXX',
      role: newForm.role,
      experience: newForm.experience,
      resumeUrl: '#',
      appliedDate: new Date().toISOString().split('T')[0],
      stage: 'Applied',
      score: Number(newForm.score),
      notes: newForm.notes || 'Manual recruiter screening scheduled.'
    };

    onAddCandidate(newCand);
    setIsAddingCandidate(false);
    // Reset form
    setNewForm({
      name: '',
      email: '',
      phone: '',
      role: 'Fullstack Node & React Developer',
      experience: '2 Years',
      score: 80,
      notes: ''
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 70) return 'text-indigo-600 bg-indigo-50 border-indigo-200';
    return 'text-amber-600 bg-amber-50 border-amber-200';
  };

  const getStageBadgeColor = (stage: string) => {
    switch (stage) {
      case 'Applied': return 'bg-slate-100 text-slate-700';
      case 'Screening': return 'bg-blue-50 text-blue-700 border-blue-100 border';
      case 'Interview': return 'bg-purple-50 text-purple-700 border-purple-100 border';
      case 'Offered': return 'bg-amber-50 text-amber-700 border-amber-100 border';
      case 'Hired': return 'bg-green-50 text-green-700 border-green-100 border';
      case 'Rejected': return 'bg-red-50 text-red-700 border-red-100 border';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Search Header toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white border border-slate-200 p-4 rounded-xl shadow-xs">
        <div className="flex flex-1 gap-2.5 w-full">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="Search candidate by name, skills, role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500"
            />
          </div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-2 font-medium focus:outline-hidden text-slate-600 bg-white"
          >
            {uniqueRoles.map((role, i) => (
              <option key={i} value={role}>{role}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setIsAddingCandidate(true)}
          className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-transform flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Applicant</span>
        </button>
      </div>

      {/* Kanban Layout / Stage Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 items-start">
        {STAGES.map((stage) => {
          const stageCandidates = filteredCandidates.filter(c => c.stage === stage);
          return (
            <div key={stage} className="bg-slate-50/70 border border-slate-200/60 rounded-2xl flex flex-col min-h-[500px] overflow-hidden p-3.5">
              
              {/* Header column */}
              <div className="flex justify-between items-center mb-3">
                <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-widest">{stage}</span>
                <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 font-bold font-mono text-[10px] flex items-center justify-center">
                  {stageCandidates.length}
                </span>
              </div>

              {/* Candidates inside stage list */}
              <div className="space-y-3 overflow-y-auto max-h-[550px] flex-1 pr-1">
                {stageCandidates.map((cand) => (
                  <div
                    key={cand.id}
                    onClick={() => setSelectedCandidate(cand)}
                    className="bg-white border border-slate-200/80 hover:border-indigo-400 p-3.5 rounded-xl shadow-xs hover:shadow-md transition-all cursor-pointer group space-y-3"
                  >
                    <div>
                      <div className="flex justify-between items-start gap-1">
                        <h4 className="text-xs font-bold text-slate-900 leading-tight group-hover:text-indigo-600 truncate">{cand.name}</h4>
                        <span className={`text-[9px] font-mono font-bold border px-1.5 py-0.5 rounded-md ${getScoreColor(cand.score)}`}>
                          {cand.score}%
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium block truncate mt-1">{cand.role}</span>
                    </div>

                    <div className="flex justify-between items-center text-[9px] text-slate-400 font-medium pt-1 border-t border-slate-100">
                      <span className="flex items-center gap-1 font-mono"><Clock className="w-3 h-3 text-slate-400" /> {cand.appliedDate}</span>
                      <span className="text-slate-500 font-bold">{cand.experience} exp</span>
                    </div>

                    {/* Controller arrows to transit stage fast */}
                    <div className="flex gap-1 justify-end pt-1">
                      <button
                        title="Move to previous stage"
                        onClick={(e) => {
                          e.stopPropagation();
                          transitionStage(cand, 'backward');
                        }}
                        className="p-1 hover:bg-slate-150 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        disabled={stage === 'Applied'}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title="Move to next stage"
                        onClick={(e) => {
                          e.stopPropagation();
                          transitionStage(cand, 'forward');
                        }}
                        className="p-1 hover:bg-slate-150 rounded text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        disabled={stage === 'Rejected' || stage === 'Hired'}
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                  </div>
                ))}

                {stageCandidates.length === 0 && (
                  <div className="border border-dashed border-slate-200/60 p-6 rounded-xl text-center">
                    <span className="text-[10px] text-slate-400 font-medium">No candidates in stage</span>
                  </div>
                )}
              </div>

            </div>
          );
        })}
      </div>

      {/* Overlay Details Box */}
      <AnimatePresence>
        {selectedCandidate && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-end">
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col p-6 overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-slate-150 pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Applicant File</h3>
                    <span className="text-[9px] font-mono text-slate-400 block uppercase">Reference: {selectedCandidate.id}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedCandidate(null)} className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Applicant Info Summary */}
              <div className="space-y-5">
                <div>
                  <h4 className="text-base font-extrabold text-slate-900">{selectedCandidate.name}</h4>
                  <span className="text-xs text-slate-500 font-medium block">{selectedCandidate.role}</span>
                  <div className={`mt-2.5 text-xs font-bold px-3 py-1.5 rounded-lg border w-fit font-mono ${getScoreColor(selectedCandidate.score)}`}>
                    Recruiter Score: {selectedCandidate.score} / 100
                  </div>
                </div>

                <div className="w-full h-px bg-slate-100" />

                <div className="space-y-3">
                  <h5 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider block">Candidate Contact</h5>
                  <div className="space-y-2.5 text-xs text-slate-600">
                    <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-slate-400" /> <span>{selectedCandidate.email}</span></div>
                    <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-slate-400" /> <span>{selectedCandidate.phone}</span></div>
                    <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400" /> <span>Applied {selectedCandidate.appliedDate} ({selectedCandidate.experience} Exp)</span></div>
                  </div>
                </div>

                <div className="w-full h-px bg-slate-100" />

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h5 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Evaluation Stage</h5>
                    <span className={`text-[10px] font-bold px-2 px-2.5 py-1 rounded-full ${getStageBadgeColor(selectedCandidate.stage)}`}>
                      {selectedCandidate.stage}
                    </span>
                  </div>
                  
                  {/* Quick transition triggers inside portal detail */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      disabled={selectedCandidate.stage === 'Applied'}
                      onClick={() => transitionStage(selectedCandidate, 'backward')}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs disabled:opacity-40"
                    >
                      ← Previous Stage
                    </button>
                    <button
                      disabled={selectedCandidate.stage === 'Rejected' || selectedCandidate.stage === 'Hired'}
                      onClick={() => transitionStage(selectedCandidate, 'forward')}
                      className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs disabled:opacity-40"
                    >
                      Next Stage →
                    </button>
                  </div>
                </div>

                <div className="w-full h-px bg-slate-100" />

                <div className="space-y-3">
                  <h5 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider block font-sans">Interview & Screening Notes</h5>
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl relative">
                    <blockquote className="text-xs italic text-slate-600 leading-relaxed block pl-2 border-l-2 border-[#2E6FE6]">
                      "{selectedCandidate.notes || 'No evaluations logged yet. Standard review required.'}"
                    </blockquote>
                  </div>
                </div>

                <div className="pt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      onUpdateCandidate({ ...selectedCandidate, stage: 'Rejected' });
                      setSelectedCandidate(null);
                    }}
                    className="px-4 py-2 text-xs font-bold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
                  >
                    Reject Applicant
                  </button>
                  <button
                    onClick={() => {
                      onUpdateCandidate({ ...selectedCandidate, stage: 'Hired' });
                      setSelectedCandidate(null);
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Hire Candidate</span>
                  </button>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Slideout popup for creating a candidate */}
      <AnimatePresence>
        {isAddingCandidate && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex justify-between items-center bg-slate-50 px-6 py-4 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-widest block">Register Candidate Applicant</span>
                <button onClick={() => setIsAddingCandidate(false)} className="p-1 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateApplicant} className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Harshit Singhania"
                      value={newForm.name}
                      onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="harshit.sh@gmail.com"
                      value={newForm.email}
                      onChange={(e) => setNewForm({ ...newForm, email: e.target.value })}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Phone Number</label>
                    <input
                      type="text"
                      placeholder="+91 94500 00122"
                      value={newForm.phone}
                      onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Total Experience</label>
                    <input
                      type="text"
                      placeholder="e.g., 3.5 Years"
                      value={newForm.experience}
                      onChange={(e) => setNewForm({ ...newForm, experience: e.target.value })}
                      className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Applying For Role</label>
                  <select
                    value={newForm.role}
                    onChange={(e) => setNewForm({ ...newForm, role: e.target.value })}
                    className="w-full text-xs border border-slate-200 bg-white rounded-lg px-3 py-2 focus:outline-hidden"
                  >
                    <option value="Fullstack Node & React Developer">Fullstack Node & React Developer</option>
                    <option value="Product Marketing Specialist">Product Marketing Specialist</option>
                    <option value="UX/UI Designer">UX/UI Designer</option>
                    <option value="Kubernetes & DevOps Engineer">Kubernetes & DevOps Engineer</option>
                    <option value="Lead Software Architect">Lead Software Architect</option>
                    <option value="Financial Analyst">Financial Analyst</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Recruiter Phone Screening Score</label>
                    <span className="text-xs font-bold text-indigo-600 font-mono">{newForm.score}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={newForm.score}
                    onChange={(e) => setNewForm({ ...newForm, score: Number(e.target.value) })}
                    className="w-full accent-indigo-600"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Evaluator Direct Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Provide details about technical checks, credentials, or communication parameters..."
                    value={newForm.notes}
                    onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
                    className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-hidden focus:border-indigo-500"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsAddingCandidate(false)}
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
