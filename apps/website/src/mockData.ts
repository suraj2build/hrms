import { Employee, Candidate, LeaveRequest, AttendanceLog, HelpdeskTicket, Announcement, PublicShoutout, PayrollRecord, ExpenseClaim } from './types';

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: "EMP-101",
    name: "Aditya Sharma",
    email: "aditya.sharma@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMkU2RkU2Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5BUzwvdGV4dD48L3N2Zz4=",
    role: "Lead Software Architect",
    department: "Engineering",
    joinedDate: "2023-01-15",
    salary: 135000,
    status: "Active",
    workMode: "Hybrid",
    phone: "+91 98765 43210",
    manager: "Sanjana Mehta (CTO)"
  },
  {
    id: "EMP-102",
    name: "Priya Nair",
    email: "priya.nair@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMTVCOEE2Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5QTjwvdGV4dD48L3N2Zz4=",
    role: "Senior UX Researcher",
    department: "Marketing",
    joinedDate: "2023-03-10",
    salary: 95000,
    status: "Active",
    workMode: "Remote",
    phone: "+91 91234 56789",
    manager: "Rohan Das"
  },
  {
    id: "EMP-103",
    name: "Vikram Malhotra",
    email: "vikram.m@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMUE0RkEwJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5WTTwvdGV4dD48L3N2Zz4=",
    role: "HR Operations Specialist",
    department: "HR",
    joinedDate: "2023-06-01",
    salary: 78000,
    status: "Active",
    workMode: "On-site",
    phone: "+91 87654 32109",
    manager: "Kavita Rao"
  },
  {
    id: "EMP-104",
    name: "Ananya Iyer",
    email: "ananya.iyer@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjRUM0ODk5Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5BSTwvdGV4dD48L3N2Zz4=",
    role: "V.P. of Product Marketing",
    department: "Marketing",
    joinedDate: "2022-11-20",
    salary: 160005,
    status: "On Leave",
    workMode: "Remote",
    phone: "+91 93456 78901",
    manager: "Kavita Rao"
  },
  {
    id: "EMP-105",
    name: "Rohan Deshmukh",
    email: "rohan.d@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjRjU5RTBCJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5SRDwvdGV4dD48L3N2Zz4=",
    role: "DevOps Engineer",
    department: "Engineering",
    joinedDate: "2024-02-18",
    salary: 87000,
    status: "Active",
    workMode: "Hybrid",
    phone: "+91 99887 76655",
    manager: "Aditya Sharma"
  },
  {
    id: "EMP-106",
    name: "Kavita Rao",
    email: "kavita.rao@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMTBCOTgxJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5LUjwvdGV4dD48L3N2Zz4=",
    role: "Chief Of HR / VP People Services",
    department: "HR",
    joinedDate: "2021-08-01",
    salary: 210000,
    status: "Active",
    workMode: "On-site",
    phone: "+91 90001 90002",
    manager: "Rahul Singhal (CEO)"
  },
  {
    id: "EMP-107",
    name: "Siddharth Verma",
    email: "siddharth.v@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMEY3NjZFJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5TVjwvdGV4dD48L3N2Zz4=",
    role: "Senior Sales Executive",
    department: "Sales",
    joinedDate: "2023-10-05",
    salary: 82000,
    status: "Active",
    workMode: "On-site",
    phone: "+91 77766 55544",
    manager: "Tariq Mahmood"
  },
  {
    id: "EMP-108",
    name: "Meera Fernandez",
    email: "meera.f@saartech.in",
    avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjN0MzQUVEJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5NRjwvdGV4dD48L3N2Zz4=",
    role: "Senior Finance Controller",
    department: "Finance",
    joinedDate: "2022-04-12",
    salary: 118000,
    status: "Active",
    workMode: "Hybrid",
    phone: "+91 88877 66655",
    manager: "Rahul Singhal (CEO)"
  }
];

export const INITIAL_CANDIDATES: Candidate[] = [
  {
    id: "CAN-401",
    name: "Deepak Chawla",
    email: "deepak.chawla@gmail.com",
    phone: "+91 98333 44222",
    role: "Fullstack Node & React Developer",
    experience: "4.5 Years",
    resumeUrl: "#",
    appliedDate: "2026-06-05",
    stage: "Interview",
    score: 88,
    notes: "Demonstrated excellent command over React server components and distributed systems during technical round-1. Clear system diagram presentation."
  },
  {
    id: "CAN-402",
    name: "Sneha Sen",
    email: "snehasen95@live.com",
    phone: "+91 99111 22888",
    role: "Product Marketing Specialist",
    experience: "3 Years",
    resumeUrl: "#",
    appliedDate: "2026-06-03",
    stage: "Screening",
    score: 74,
    notes: "Good communication skills. Portfolio had impressive campaign reviews. Compensation expectations match bounds."
  },
  {
    id: "CAN-403",
    name: "Arjun Rampal",
    email: "arjun.rampal22@outlook.com",
    phone: "+91 95444 33311",
    role: "UX/UI Designer",
    experience: "6 Years",
    resumeUrl: "#",
    appliedDate: "2026-06-01",
    stage: "Offered",
    score: 94,
    notes: "Exceptional UI skills, pristine typography and spacing in the take-home test. Offered rolled out on 2026-06-05. Awaiting confirmation."
  },
  {
    id: "CAN-404",
    name: "Nandini Gupta",
    email: "nandinig.official@gmail.com",
    phone: "+91 92222 33344",
    role: "Kubernetes & DevOps Engineer",
    experience: "5 Years",
    resumeUrl: "#",
    appliedDate: "2026-05-28",
    stage: "Hired",
    score: 91,
    notes: "Selected for our AWS Cloud migration and container scaling track. Onboarding date set for July 1st, 2026."
  },
  {
    id: "CAN-405",
    name: "Vikrant Patil",
    email: "vikrant.patil@yahoo.co.in",
    phone: "+91 88392 10101",
    role: "Lead Software Architect",
    experience: "10 Years",
    resumeUrl: "#",
    appliedDate: "2026-05-15",
    stage: "Rejected",
    score: 52,
    notes: "Lacked hands-on experience in cloud architectures and high-concurrency systems, which is vital for the Lead Role."
  },
  {
    id: "CAN-406",
    name: "Ayesha Ahmed",
    email: "ayesha99@gmail.com",
    phone: "+91 72121 89890",
    role: "Financial Analyst",
    experience: "2 Years",
    resumeUrl: "#",
    appliedDate: "2026-06-07",
    stage: "Applied",
    score: 82,
    notes: "Reviewing resume. Strong accounting credentials, certified CA Foundation."
  }
];

export const INITIAL_LEAVE_REQUESTS: LeaveRequest[] = [
  {
    id: "LV-201",
    employeeId: "EMP-104",
    employeeName: "Ananya Iyer",
    employeeAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjRUM0ODk5Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5BSTwvdGV4dD48L3N2Zz4=",
    leaveType: "Privilege Leave",
    startDate: "2026-06-10",
    endDate: "2026-06-17",
    days: 7,
    reason: "Going on a family trip to Ladakh. Will be offline for the week.",
    status: "Pending",
    appliedDate: "2026-06-05"
  },
  {
    id: "LV-202",
    employeeId: "EMP-102",
    employeeName: "Priya Nair",
    employeeAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMTVCOEE2Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5QTjwvdGV4dD48L3N2Zz4=",
    leaveType: "Sick Leave",
    startDate: "2026-06-08",
    endDate: "2026-06-09",
    days: 2,
    reason: "Suffering from high seasonal flu and sore throat. Doctor advised 2 days bed rest.",
    status: "Approved",
    appliedDate: "2026-06-07"
  },
  {
    id: "LV-203",
    employeeId: "EMP-105",
    employeeName: "Rohan Deshmukh",
    employeeAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjRjU5RTBCJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5SRDwvdGV4dD48L3N2Zz4=",
    leaveType: "Casual Leave",
    startDate: "2026-06-12",
    endDate: "2026-06-12",
    days: 1,
    reason: "To attend lease registry scheduling with the municipal office.",
    status: "Pending",
    appliedDate: "2026-06-06"
  },
  {
    id: "LV-204",
    employeeId: "EMP-107",
    employeeName: "Siddharth Verma",
    employeeAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMEY3NjZFJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5TVjwvdGV4dD48L3N2Zz4=",
    leaveType: "Unpaid Leave",
    startDate: "2026-05-12",
    endDate: "2026-05-15",
    days: 4,
    reason: "Personal urgent medical scenario at home.",
    status: "Approved",
    appliedDate: "2026-05-10"
  }
];

export const INITIAL_ATTENDANCE_LOGS: AttendanceLog[] = [
  {
    id: "AT-301",
    employeeId: "EMP-101",
    date: "2026-06-08",
    clockIn: "08:52 AM",
    clockOut: "18:15 PM",
    status: "On-Time",
    locationSim: "Office IP - Geofenced"
  },
  {
    id: "AT-302",
    employeeId: "EMP-103",
    date: "2026-06-08",
    clockIn: "09:35 AM",
    clockOut: "18:30 PM",
    status: "Late",
    locationSim: "Biometric Portal - Suite A"
  },
  {
    id: "AT-303",
    employeeId: "EMP-105",
    date: "2026-06-08",
    clockIn: "09:05 AM",
    status: "On-Time",
    locationSim: "Remote GPS - 19.076, 72.877"
  },
  {
    id: "AT-304",
    employeeId: "EMP-106",
    date: "2026-06-08",
    clockIn: "08:45 AM",
    clockOut: "17:45 PM",
    status: "On-Time",
    locationSim: "Office IP - Geofenced"
  },
  {
    id: "AT-305",
    employeeId: "EMP-107",
    date: "2026-06-08",
    clockIn: "10:15 AM",
    status: "Half-Day",
    locationSim: "Sales Field Georeferenced Trigger"
  },
  {
    id: "AT-306",
    employeeId: "EMP-108",
    date: "2026-06-08",
    clockIn: "08:58 AM",
    status: "On-Time",
    locationSim: "Office IP - Geofenced"
  }
];

export const INITIAL_ANNOUNCEMENTS: Announcement[] = [
  {
    id: "ANN-1",
    title: "CognixHR's Q3 Objectives and Key Results (OKRs) Launched!",
    content: "Team, we have formally published our Q3 Core OKRs in the Performance module. Our key focus is supporting 99.99% database uptime for high-growth customers and establishing our Singapore expansion, targeting 20 new logos. Please align your group and individual targets by the end of this week. Let's build ahead!",
    category: "Company Policy",
    date: "2026-06-07",
    author: {
      name: "Kavita Rao",
      role: "VP People Services",
      avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMTBCOTgxJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5LUjwvdGV4dD48L3N2Zz4="
    }
  },
  {
    id: "ANN-2",
    title: "Standardizing Hybrid Policy: 3 Days Office Presence",
    content: "To support deeper mentorship, whiteboard architecture jams, and cultural alignment, we are formalizing the 3-day office presence (Tue-Thu) for all Hybrid contract employees starting next Monday. Mondays & Fridays are fully optional for remote operations. Thank you for making our collaboration vibrant!",
    category: "Company Policy",
    date: "2026-06-05",
    author: {
      name: "Rahul Singhal",
      role: "Founder & CEO",
      avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMEY3NjZFJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5SUzwvdGV4dD48L3N2Zz4="
    }
  },
  {
    id: "ANN-3",
    title: "Annual Hackfest 'Hack-And-Heal' scheduled for July 12th",
    content: "Dust off your ideation sketchbooks! Our annual software marathon, Hack-And-Heal 2026 is officially on. 48 hours, fully funded pizzas, sleeping couches, and amazing awards (including premium curved monitors and ergonomic chairs). Theme: 'Empowerment through Simplicity.' Teams can combine up to 4 people.",
    category: "Event",
    date: "2026-06-03",
    author: {
      name: "Sanjana Mehta",
      role: "Chief Of Technology",
      avatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjRUM0ODk5Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5TTTwvdGV4dD48L3N2Zz4="
    }
  }
];

export const INITIAL_FEEDBACK_POSTS: PublicShoutout[] = [
  {
    id: "FEED-01",
    senderName: "Aditya Sharma",
    senderAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMkU2RkU2Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5BUzwvdGV4dD48L3N2Zz4=",
    receiverName: "Rohan Deshmukh",
    receiverAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjRjU5RTBCJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5SRDwvdGV4dD48L3N2Zz4=",
    message: "A massive shoutout to Rohan for staying up past midnight yesterday to patch the AWS network route tables! He restored our staging database cluster without losing anything. True Bias for Action, my friend!",
    badge: "Bias for Action",
    date: "2026-06-08",
    likes: 8
  },
  {
    id: "FEED-02",
    senderName: "Priya Nair",
    senderAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMTVCOEE2Jy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5QTjwvdGV4dD48L3N2Zz4=",
    receiverName: "Vikram Malhotra",
    receiverAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMUE0RkEwJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5WTTwvdGV4dD48L3N2Zz4=",
    message: "Thank you Vikram for making the relocation claim and paper process so painless last week. Standard reimbursement can be difficult, but you sat with me and solved it in 15 minutes. Pure Excellence!",
    badge: "Excellence",
    date: "2026-06-07",
    likes: 12
  },
  {
    id: "FEED-03",
    senderName: "Kavita Rao",
    senderAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjMTBCOTgxJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5LUjwvdGV4dD48L3N2Zz4=",
    receiverName: "Meera Fernandez",
    receiverAvatar: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxMDAgMTAwJz48cmVjdCB3aWR0aD0nMTAwJyBoZWlnaHQ9JzEwMCcgcng9JzUwJyBmaWxsPScjN0MzQUVEJy8+PHRleHQgeD0nNTAnIHk9JzY3JyBmb250LWZhbWlseT0nc3lzdGVtLXVpLHNhbnMtc2VyaWYnIGZvbnQtd2VpZ2h0PSc3MDAnIGZvbnQtc2l6ZT0nNDAnIHRleHQtYW5jaG9yPSdtaWRkbGUnIGZpbGw9J3doaXRlJz5NRjwvdGV4dD48L3N2Zz4=",
    message: "Grateful to Meera for her relentless precision during the annual audit coordination. We successfully passed compliance with zero corrective actions needed. High level of Collaboration and ownership!",
    badge: "Collaboration",
    date: "2026-06-06",
    likes: 5
  }
];

export const INITIAL_TICKETS: HelpdeskTicket[] = [
  {
    id: "TKT-501",
    employeeName: "Aditya Sharma",
    title: "Keyboard key sticky - request replacement",
    category: "IT Support",
    description: "The 'D' and 'S' switches on my wireless mechanical keyboard have become inconsistent. Requesting helper exchange or standard MX replacement.",
    status: "In Progress",
    priority: "Low",
    date: "2026-06-07"
  },
  {
    id: "TKT-502",
    employeeName: "Priya Nair",
    title: "Incorrect TDS deduction on March variable component",
    category: "Payroll",
    description: "My payslip for March notes a TDS deduction that overshot my standard slab category. Already updated declarations. Please verify query.",
    status: "Open",
    priority: "High",
    date: "2026-06-08"
  },
  {
    id: "TKT-503",
    employeeName: "Rohan Deshmukh",
    title: "Need corporate email confirmation for Udemy team access",
    category: "Admin",
    description: "Sanjana approved team access to Kubernetes Advance Masterclass on Udemy. Requesting email credential confirmation.",
    status: "Resolved",
    priority: "Medium",
    date: "2026-06-06"
  }
];

export const INITIAL_EXPENSES: ExpenseClaim[] = [
  {
    id: "EXP-901",
    employeeName: "Siddharth Verma",
    title: "Client Dinner with TechCorp VP",
    category: "Meals",
    amount: 6200,
    date: "2026-06-06",
    status: "Pending"
  },
  {
    id: "EXP-902",
    employeeName: "Aditya Sharma",
    title: "Broadband Reimbursement (May 2026)",
    category: "Internet & Phone",
    amount: 1599,
    date: "2026-06-03",
    status: "Approved"
  },
  {
    id: "EXP-903",
    employeeName: "Priya Nair",
    title: "Unresolved Travel Cab to Airport - UX Workshop",
    category: "Travel",
    amount: 1250,
    date: "2026-06-01",
    status: "Approved"
  }
];

// Generates direct Payroll records of the initial employees
export function getInitialPayrollRecords(employees: Employee[]): PayrollRecord[] {
  return employees.map((emp) => {
    // Standard calculations based on employee's base salary
    const base = Math.round(emp.salary * 0.5); // 50% basic
    const hra = Math.round(base * 0.4); // 40% of basic
    const allowance = emp.salary - base - hra; // special allowance is rest
    const pf = Math.round(base * 0.12); // 12% of basic
    const tax = Math.round(emp.salary * 0.15); // average tax simulation
    const net = emp.salary - pf - tax;

    return {
      employeeId: emp.id,
      employeeName: emp.name,
      department: emp.department,
      role: emp.role,
      basicSalary: base,
      hra: hra,
      specialAllowance: allowance,
      pfDeduction: pf,
      taxDeduction: tax,
      grossSalary: emp.salary,
      netSalary: net,
      paymentStatus: emp.id === "EMP-104" ? "Held" : "Paid"
    };
  });
}
