import React, { useRef } from 'react';
import { X, Printer, Download, Check, Building, FileText, Landmark } from 'lucide-react';
import { PayrollRecord, Employee } from '../types';

interface PayslipModalProps {
  record: PayrollRecord;
  employee: Employee;
  onClose: () => void;
}

export default function PayslipModal({ record, employee, onClose }: PayslipModalProps) {
  const [downloadSuccess, setDownloadSuccess] = React.useState(false);

  const handleDownloadSim = () => {
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  // Convert numbers to words (simple lookup for payroll bounds)
  const amountToWords = (amount: number) => {
    let num = amount;
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const inWords = (n: number): string => {
      if (n < 20) return a[n];
      if (n < 100) return b[Math.floor(n / 10)] + ' ' + a[n % 10];
      if (n < 1000) return a[Math.floor(n / 100)] + 'Hundred ' + inWords(n % 100);
      return a[Math.floor(n / 1000)] + 'Thousand ' + inWords(n % 1000);
    };

    return inWords(num) + "Rupees Only";
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header toolbar */}
        <div className="flex justify-between items-center bg-slate-50 px-6 py-4 border-b border-slate-100 rounded-t-3xl">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-50 border border-indigo-200 text-indigo-600 rounded-lg">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-800">Salary Pay Slip Reciept</span>
              <span className="text-[10px] block font-mono text-slate-400">ID: {record.employeeId}-PS-05</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-bold"
            >
              <Printer className="w-4 h-4" />
              <span>Print Slips</span>
            </button>
            <button
              onClick={handleDownloadSim}
              className="p-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-bold relative"
            >
              {downloadSuccess ? (
                <>
                  <Check className="w-4 h-4 text-green-500" />
                  <span className="text-green-600">Saved!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Slip</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-full transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Slips Content */}
        <div id="payslip-print-section" className="p-8 space-y-8 bg-white font-sans text-slate-800 selection:bg-indigo-100">
          
          {/* Company branding */}
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-800 text-white font-bold text-xl flex items-center justify-center">
                E
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-slate-950 uppercase tracking-wide">CognixHR Technologies Private Limited</h2>
                <p className="text-[10px] text-slate-400 leading-normal max-w-[320px]">
                  B-Block, 4th Floor, Sector 62, Noida, NCR, India.<br />
                  CIN: U74999DL2026PTC334512 | contact@cognixhr.co
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-mono">Pay Slip</span>
              <h3 className="text-base font-extrabold text-slate-800 mt-1">For The Month: May 2026</h3>
              <span className="text-[10px] px-2.5 py-1 bg-green-50 text-green-700 border border-green-100 rounded-full font-bold ml-auto block w-fit mt-1">
                Settled & Transferred
              </span>
            </div>
          </div>

          <div className="w-full h-px bg-slate-200" />

          {/* Details segment */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-6 text-xs">
            <div>
              <span className="text-slate-400 block font-medium">Employee Name</span>
              <span className="font-extrabold text-slate-800">{record.employeeName}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Employee Code</span>
              <span className="font-bold text-slate-800 font-mono">{record.employeeId}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Department</span>
              <span className="font-semibold text-slate-800">{record.department}</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Designation</span>
              <span className="font-semibold text-slate-800">{record.role}</span>
            </div>

            <div>
              <span className="text-slate-400 block font-medium">Bank Name</span>
              <span className="font-semibold text-slate-800">Landmark Alliance Bank</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Bank A/C Number</span>
              <span className="font-mono text-slate-800">XXXX XXXX 9081</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">Tax Identifier (PAN)</span>
              <span className="font-mono text-slate-800">ALHPXXXXXA</span>
            </div>
            <div>
              <span className="text-slate-400 block font-medium">LOP Days (Unpaid)</span>
              <span className="font-semibold text-slate-800">{employee.status === 'On Leave' ? '3 Days' : '0 Days'}</span>
            </div>
          </div>

          {/* Ledger tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
            {/* Earnings column */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex justify-between text-xs font-bold text-slate-700">
                <span>Earning Components</span>
                <span>Amount (₹)</span>
              </div>
              <div className="p-4 space-y-3.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Basic Salary (50% Base)</span>
                  <span className="font-mono text-slate-800 font-semibold">₹{record.basicSalary.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>House Rent Allowance (HRA)</span>
                  <span className="font-mono text-slate-800 font-semibold">₹{record.hra.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Special Allowance</span>
                  <span className="font-mono text-slate-800 font-semibold">₹{record.specialAllowance.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Performance Incentive</span>
                  <span className="font-mono font-semibold">+₹2,500</span>
                </div>
              </div>
              <div className="bg-slate-50/50 border-t border-slate-200 px-4 py-3.5 flex justify-between text-xs font-extrabold text-slate-800 rounded-b-2xl">
                <span>Gross Earnings (A)</span>
                <span className="font-mono text-indigo-700">₹{(record.grossSalary + 2500).toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Deductions column */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 flex justify-between text-xs font-bold text-slate-700">
                <span>Deductions</span>
                <span>Amount (₹)</span>
              </div>
              <div className="p-4 space-y-3.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Provident Fund (PF Employer & Employee)</span>
                  <span className="font-mono text-slate-800 font-semibold">₹{record.pfDeduction.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Income Tax Ded. (TDS)</span>
                  <span className="font-mono text-slate-800 font-semibold">₹{record.taxDeduction.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Professional Tax (PT)</span>
                  <span className="font-mono text-slate-800 font-semibold">₹200</span>
                </div>
                <div className="flex justify-between">
                  <span>Loss of Pay Deduction</span>
                  <span className="font-mono text-slate-800 font-semibold">₹0</span>
                </div>
              </div>
              <div className="bg-slate-50/50 border-t border-slate-200 px-4 py-3.5 flex justify-between text-xs font-extrabold text-slate-800 rounded-b-2xl">
                <span>Total Deductions (B)</span>
                <span className="font-mono text-red-700">₹{(record.pfDeduction + record.taxDeduction + 200).toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          {/* Ledger summary & signature */}
          <div className="bg-indigo-900 text-white rounded-2xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold font-mono tracking-wider text-indigo-300 uppercase block">Net Salary (A - B)</span>
              <span className="text-2xl font-extrabold font-mono text-white">₹{(record.grossSalary + 2500 - (record.pfDeduction + record.taxDeduction + 200)).toLocaleString('en-IN')}</span>
              <span className="text-[10px] text-indigo-200 italic block pt-1 font-medium font-sans">
                In words: {amountToWords(record.grossSalary + 2500 - (record.pfDeduction + record.taxDeduction + 200))}
              </span>
            </div>
            <div className="flex items-center gap-3 bg-indigo-950 px-4 py-2 rounded-xl border border-indigo-800">
              <Landmark className="w-5 h-5 text-indigo-400" />
              <div className="text-left font-sans">
                <span className="text-[9px] text-slate-400 uppercase font-mono block">Direct Bank Transfer Auth</span>
                <span className="text-xs font-bold text-indigo-200 font-mono text-left">Ref: #TXN-908122-LAB</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-[10px] text-slate-400 gap-4 pt-4">
            <div className="max-w-[400px]">
              <span className="font-semibold block">Declaration Note:</span>
              <p className="leading-relaxed">This slip represents a digitally generated tax credit invoice, authenticated by CognixHR HR Services. No manual signature validation is legally required under standard IT compliance codes.</p>
            </div>
            <div className="text-right font-serif opacity-30 select-none text-2xl font-bold tracking-widest uppercase border border-dashed border-slate-400 px-4 py-1">
              CognixHR SECURE
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
