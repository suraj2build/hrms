export interface Employee {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  department: 'Engineering' | 'Sales' | 'HR' | 'Marketing' | 'Operations' | 'Finance';
  joinedDate: string;
  salary: number;
  status: 'Active' | 'On Leave' | 'Suspended';
  workMode: 'Remote' | 'On-site' | 'Hybrid';
  phone: string;
  manager: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  experience: string;
  resumeUrl: string;
  appliedDate: string;
  stage: 'Applied' | 'Screening' | 'Interview' | 'Offered' | 'Hired' | 'Rejected';
  score: number; // 0-100 rating
  notes?: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string;
  leaveType: 'Casual Leave' | 'Sick Leave' | 'Privilege Leave' | 'Maternity Leave' | 'Unpaid Leave';
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  appliedDate: string;
}

export interface AttendanceLog {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut?: string;
  status: 'On-Time' | 'Late' | 'Half-Day' | 'Absent';
  locationSim?: string;
}

export interface HelpdeskTicket {
  id: string;
  employeeName: string;
  title: string;
  category: 'Payroll' | 'IT Support' | 'HR Query' | 'Admin';
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  priority: 'Low' | 'Medium' | 'High';
  date: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  category: 'Company Policy' | 'Event' | 'Holiday' | 'Tech Update';
  date: string;
  author: {
    name: string;
    role: string;
    avatar: string;
  };
}

export interface PublicShoutout {
  id: string;
  senderName: string;
  senderAvatar: string;
  receiverName: string;
  receiverAvatar: string;
  message: string;
  badge: 'Collaboration' | 'Customer Obsession' | 'Excellence' | 'Humility' | 'Bias for Action';
  date: string;
  likes: number;
}

export interface PayrollRecord {
  employeeId: string;
  employeeName: string;
  department: string;
  role: string;
  basicSalary: number;
  hra: number;
  specialAllowance: number;
  pfDeduction: number;
  taxDeduction: number;
  grossSalary: number;
  netSalary: number;
  paymentStatus: 'Paid' | 'Processing' | 'Held';
}

export interface ExpenseClaim {
  id: string;
  employeeName: string;
  title: string;
  category: 'Travel' | 'Meals' | 'Internet & Phone' | 'Office Supplies' | 'Others';
  amount: number;
  date: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  invoiceUrl?: string;
}
