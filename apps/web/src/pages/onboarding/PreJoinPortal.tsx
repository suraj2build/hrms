import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { uploadToSignedUrl } from "@/lib/supabase-storage";
import { LogoMark, Wordmark } from "@/components/brand/Logo";
import { brandConfig }        from "@/lib/brand-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageState = "loading" | "expired" | "already_submitted" | "form" | "success";

interface OnboardingMeta {
  company_name: string;
  joining_date: string;
  candidate_name: string;
}

interface FormData {
  // Step 0 — HR-prefilled identity/role (editable, but changes are flagged for HR)
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  joining_date: string;
  // Step 1
  date_of_birth: string;
  gender: string;
  blood_group: string;
  marital_status: string;
  nationality: string;
  // Step 2
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string;
  // Step 3
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  account_type: string;
  pan_number: string;
  aadhaar_number: string;
  uan_number: string;
  // Step 4
  declaration: boolean;
}

const emptyForm: FormData = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  designation: "",
  department: "",
  joining_date: "",
  date_of_birth: "",
  gender: "",
  blood_group: "",
  marital_status: "",
  nationality: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  pincode: "",
  emergency_name: "",
  emergency_phone: "",
  emergency_relationship: "",
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  account_type: "",
  pan_number: "",
  aadhaar_number: "",
  uan_number: "",
  declaration: false,
};

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground placeholder:text-muted-foreground focus:border-[#2E6FE6] focus:outline-none focus:ring-2 focus:ring-[#2E6FE6]/20 transition";

const selectClass =
  "w-full rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground bg-white focus:border-[#2E6FE6] focus:outline-none focus:ring-2 focus:ring-[#2E6FE6]/20 transition";

// ---------------------------------------------------------------------------
// HR-prefilled identity/role fields (editable, but edits are flagged for HR)
// ---------------------------------------------------------------------------

type IdentityKey =
  | "first_name" | "last_name" | "email" | "phone"
  | "designation" | "department" | "joining_date";

const IDENTITY_FIELDS: { key: IdentityKey; label: string; type: "text" | "email" | "tel" | "date"; required?: boolean }[] = [
  { key: "first_name",   label: "First Name",   type: "text",  required: true },
  { key: "last_name",    label: "Last Name",    type: "text",  required: true },
  { key: "email",        label: "Email",        type: "email", required: true },
  { key: "phone",        label: "Phone",        type: "tel" },
  { key: "designation",  label: "Designation",  type: "text" },
  { key: "department",   label: "Department",   type: "text" },
  { key: "joining_date", label: "Joining Date", type: "date" },
];

// A field is "edited" when HR provided a value and the candidate changed it.
function isIdentityEdited(key: IdentityKey, form: FormData, prefilled: Partial<Record<IdentityKey, string>>): boolean {
  const orig = (prefilled[key] ?? "").trim();
  return orig !== "" && (form[key] ?? "").trim() !== orig;
}

// Returns the identity fields the candidate changed away from the HR values.
function editedIdentityFields(form: FormData, prefilled: Partial<Record<IdentityKey, string>>): IdentityKey[] {
  return IDENTITY_FIELDS.map((f) => f.key).filter((k) => isIdentityEdited(k, form, prefilled));
}

function IdentitySection({
  form,
  prefilled,
  onChange,
}: {
  form: FormData;
  prefilled: Partial<Record<IdentityKey, string>>;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-foreground">Confirm your details</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        These were provided by your employer. Please review them — you can make
        corrections, but any change will be flagged for HR to confirm.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {IDENTITY_FIELDS.map((f) => {
          const edited = isIdentityEdited(f.key, form, prefilled);
          return (
            <FieldRow key={f.key} label={f.label} required={f.required}>
              <div className="relative">
                <input
                  type={f.type}
                  className={inputClass}
                  value={form[f.key]}
                  onChange={(e) => onChange(f.key, e.target.value)}
                />
                {edited && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    Edited
                  </span>
                )}
              </div>
            </FieldRow>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Previous employment (candidate-declared work history, 0..N entries)
// ---------------------------------------------------------------------------

interface PrevEmployer {
  company_name: string;
  designation: string;
  from_date: string;
  to_date: string;
  last_ctc: string;
  reason_for_leaving: string;
}

const emptyPrevEmployer: PrevEmployer = {
  company_name: "",
  designation: "",
  from_date: "",
  to_date: "",
  last_ctc: "",
  reason_for_leaving: "",
};

function PrevEmploymentSection({
  employers,
  onChange,
}: {
  employers: PrevEmployer[];
  onChange: (next: PrevEmployer[]) => void;
}) {
  function update(i: number, key: keyof PrevEmployer, val: string) {
    onChange(employers.map((e, idx) => (idx === i ? { ...e, [key]: val } : e)));
  }
  function add() {
    onChange([...employers, { ...emptyPrevEmployer }]);
  }
  function remove(i: number) {
    onChange(employers.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-4">
      {employers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          If you have prior work experience, add your previous employer(s) below.
          You can skip this if you are a fresher.
        </p>
      )}

      {employers.map((emp, i) => (
        <div key={i} className="rounded-xl border border-border p-4 sm:p-5 relative">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">Employer {i + 1}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-xs font-medium text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldRow label="Company Name" required>
              <input className={inputClass} value={emp.company_name} onChange={(e) => update(i, "company_name", e.target.value)} />
            </FieldRow>
            <FieldRow label="Designation">
              <input className={inputClass} value={emp.designation} onChange={(e) => update(i, "designation", e.target.value)} />
            </FieldRow>
            <FieldRow label="From">
              <input type="date" className={inputClass} value={emp.from_date} onChange={(e) => update(i, "from_date", e.target.value)} />
            </FieldRow>
            <FieldRow label="To">
              <input type="date" className={inputClass} value={emp.to_date} onChange={(e) => update(i, "to_date", e.target.value)} />
            </FieldRow>
            <FieldRow label="Last Annual CTC (₹)">
              <input type="number" inputMode="numeric" className={inputClass} value={emp.last_ctc} onChange={(e) => update(i, "last_ctc", e.target.value)} />
            </FieldRow>
            <FieldRow label="Reason for Leaving">
              <input className={inputClass} value={emp.reason_for_leaving} onChange={(e) => update(i, "reason_for_leaving", e.target.value)} />
            </FieldRow>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="w-full rounded-lg border border-dashed border-[#2E6FE6]/50 py-2.5 text-sm font-semibold text-[#2E6FE6] hover:bg-[#2E6FE6]/5 transition"
      >
        + Add {employers.length === 0 ? "previous employer" : "another employer"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Education (candidate-declared qualifications + optional certificate, 0..N)
// ---------------------------------------------------------------------------

interface EduEntry {
  qualification: string;
  institution: string;
  specialization: string;
  year_of_completion: string;
  grade: string;
  document_path?: string;
  document_name?: string;
  uploading?: boolean;
  uploadError?: string;
}

const emptyEduEntry: EduEntry = {
  qualification: "",
  institution: "",
  specialization: "",
  year_of_completion: "",
  grade: "",
};

function EducationSection({
  entries,
  onChange,
  onFileSelect,
}: {
  entries: EduEntry[];
  onChange: (next: EduEntry[]) => void;
  onFileSelect: (index: number, file: File) => void;
}) {
  function update(i: number, key: keyof EduEntry, val: string) {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, [key]: val } : e)));
  }
  function add() {
    onChange([...entries, { ...emptyEduEntry }]);
  }
  function remove(i: number) {
    onChange(entries.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-4">
      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Add your qualifications, starting with the highest. You can attach a
          certificate for each (PDF or image).
        </p>
      )}

      {entries.map((ed, i) => (
        <div key={i} className="rounded-xl border border-border p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-foreground">Qualification {i + 1}</span>
            <button type="button" onClick={() => remove(i)} className="text-xs font-medium text-destructive hover:underline">
              Remove
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldRow label="Qualification" required>
              <input className={inputClass} placeholder="e.g. B.Tech, MBA, 12th" value={ed.qualification} onChange={(e) => update(i, "qualification", e.target.value)} />
            </FieldRow>
            <FieldRow label="Institution">
              <input className={inputClass} value={ed.institution} onChange={(e) => update(i, "institution", e.target.value)} />
            </FieldRow>
            <FieldRow label="Specialization / Stream">
              <input className={inputClass} value={ed.specialization} onChange={(e) => update(i, "specialization", e.target.value)} />
            </FieldRow>
            <FieldRow label="Year of Completion">
              <input type="number" inputMode="numeric" className={inputClass} value={ed.year_of_completion} onChange={(e) => update(i, "year_of_completion", e.target.value)} />
            </FieldRow>
            <FieldRow label="Grade / %">
              <input className={inputClass} value={ed.grade} onChange={(e) => update(i, "grade", e.target.value)} />
            </FieldRow>
            <FieldRow label="Certificate">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-lg bg-[#2E6FE6] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1A4D8F] transition inline-block shrink-0">
                  {ed.uploading ? "Uploading…" : ed.document_path ? "Replace" : "Upload"}
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    disabled={ed.uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(i, f); e.target.value = ""; }}
                  />
                </label>
                <span className="text-xs text-muted-foreground truncate">
                  {ed.uploadError
                    ? <span className="text-destructive">{ed.uploadError}</span>
                    : ed.document_name ?? "No file chosen"}
                </span>
              </div>
            </FieldRow>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="w-full rounded-lg border border-dashed border-[#2E6FE6]/50 py-2.5 text-sm font-semibold text-[#2E6FE6] hover:bg-[#2E6FE6]/5 transition"
      >
        + Add {entries.length === 0 ? "qualification" : "another qualification"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function Step1({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <FieldRow label="Date of Birth" required>
        <input
          type="date"
          className={inputClass}
          value={form.date_of_birth}
          onChange={(e) => onChange("date_of_birth", e.target.value)}
        />
      </FieldRow>

      <FieldRow label="Gender" required>
        <select
          className={selectClass}
          value={form.gender}
          onChange={(e) => onChange("gender", e.target.value)}
        >
          <option value="">Select gender</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
          <option value="Non-binary">Non-binary</option>
          <option value="Prefer not to say">Prefer not to say</option>
        </select>
      </FieldRow>

      <FieldRow label="Blood Group">
        <select
          className={selectClass}
          value={form.blood_group}
          onChange={(e) => onChange("blood_group", e.target.value)}
        >
          <option value="">Select blood group</option>
          {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => (
            <option key={bg} value={bg}>
              {bg}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Marital Status">
        <select
          className={selectClass}
          value={form.marital_status}
          onChange={(e) => onChange("marital_status", e.target.value)}
        >
          <option value="">Select status</option>
          <option value="Single">Single</option>
          <option value="Married">Married</option>
          <option value="Divorced">Divorced</option>
          <option value="Widowed">Widowed</option>
        </select>
      </FieldRow>

      <FieldRow label="Nationality" required>
        <input
          type="text"
          className={inputClass}
          placeholder="e.g. Indian"
          value={form.nationality}
          onChange={(e) => onChange("nationality", e.target.value)}
        />
      </FieldRow>
    </div>
  );
}

function Step2({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Address
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="sm:col-span-2">
            <FieldRow label="Address Line 1" required>
              <input
                type="text"
                className={inputClass}
                placeholder="Flat / House No., Building, Street"
                value={form.address_line1}
                onChange={(e) => onChange("address_line1", e.target.value)}
              />
            </FieldRow>
          </div>
          <div className="sm:col-span-2">
            <FieldRow label="Address Line 2">
              <input
                type="text"
                className={inputClass}
                placeholder="Area, Landmark (optional)"
                value={form.address_line2}
                onChange={(e) => onChange("address_line2", e.target.value)}
              />
            </FieldRow>
          </div>
          <FieldRow label="City" required>
            <input
              type="text"
              className={inputClass}
              placeholder="City"
              value={form.city}
              onChange={(e) => onChange("city", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="State" required>
            <input
              type="text"
              className={inputClass}
              placeholder="State"
              value={form.state}
              onChange={(e) => onChange("state", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Pincode" required>
            <input
              type="text"
              className={inputClass}
              placeholder="6-digit pincode"
              maxLength={6}
              value={form.pincode}
              onChange={(e) => onChange("pincode", e.target.value.replace(/\D/g, ""))}
            />
          </FieldRow>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Emergency Contact
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FieldRow label="Full Name">
            <input
              type="text"
              className={inputClass}
              placeholder="Contact person's name"
              value={form.emergency_name}
              onChange={(e) => onChange("emergency_name", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Phone Number">
            <input
              type="tel"
              className={inputClass}
              placeholder="+91 XXXXX XXXXX"
              value={form.emergency_phone}
              onChange={(e) => onChange("emergency_phone", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Relationship">
            <input
              type="text"
              className={inputClass}
              placeholder="e.g. Spouse, Parent, Sibling"
              value={form.emergency_relationship}
              onChange={(e) => onChange("emergency_relationship", e.target.value)}
            />
          </FieldRow>
        </div>
      </div>
    </div>
  );
}

function Step3({
  form,
  onChange,
}: {
  form: FormData;
  onChange: (k: keyof FormData, v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Bank Details
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FieldRow label="Bank Name" required>
            <input
              type="text"
              className={inputClass}
              placeholder="e.g. HDFC Bank"
              value={form.bank_name}
              onChange={(e) => onChange("bank_name", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Account Type" required>
            <select
              className={selectClass}
              value={form.account_type}
              onChange={(e) => onChange("account_type", e.target.value)}
            >
              <option value="">Select type</option>
              <option value="Savings">Savings</option>
              <option value="Current">Current</option>
              <option value="Salary">Salary</option>
            </select>
          </FieldRow>
          <FieldRow label="Account Number" required>
            <input
              type="text"
              className={inputClass}
              placeholder="Account number"
              value={form.account_number}
              onChange={(e) => onChange("account_number", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="IFSC Code" required>
            <input
              type="text"
              className={inputClass}
              placeholder="e.g. HDFC0001234"
              value={form.ifsc_code}
              onChange={(e) => onChange("ifsc_code", e.target.value.toUpperCase())}
            />
          </FieldRow>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Compliance &amp; Tax
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FieldRow label="PAN Number" required>
            <input
              type="text"
              className={inputClass}
              placeholder="e.g. ABCDE1234F"
              maxLength={10}
              value={form.pan_number}
              onChange={(e) => onChange("pan_number", e.target.value.toUpperCase())}
            />
          </FieldRow>
          <FieldRow label="Aadhaar Number">
            <input
              type="text"
              className={inputClass}
              placeholder="12-digit Aadhaar"
              maxLength={12}
              value={form.aadhaar_number}
              onChange={(e) => onChange("aadhaar_number", e.target.value.replace(/\D/g, ""))}
            />
          </FieldRow>
          <FieldRow label="UAN Number">
            <input
              type="text"
              className={inputClass}
              placeholder="Universal Account Number (if available)"
              value={form.uan_number}
              onChange={(e) => onChange("uan_number", e.target.value)}
            />
          </FieldRow>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground shrink-0 w-44">{label}</span>
      <span className="text-sm text-foreground text-right font-medium">{value}</span>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted rounded-xl p-4 space-y-0">
      <h4 className="text-xs font-semibold text-[#2E6FE6] uppercase tracking-wider mb-3">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Step4({
  form,
  onDeclarationChange,
}: {
  form: FormData;
  onDeclarationChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <ReviewSection title="Personal Information">
        <ReviewRow label="Date of Birth" value={form.date_of_birth} />
        <ReviewRow label="Gender" value={form.gender} />
        <ReviewRow label="Blood Group" value={form.blood_group} />
        <ReviewRow label="Marital Status" value={form.marital_status} />
        <ReviewRow label="Nationality" value={form.nationality} />
      </ReviewSection>

      <ReviewSection title="Address">
        <ReviewRow label="Address Line 1" value={form.address_line1} />
        <ReviewRow label="Address Line 2" value={form.address_line2} />
        <ReviewRow label="City" value={form.city} />
        <ReviewRow label="State" value={form.state} />
        <ReviewRow label="Pincode" value={form.pincode} />
      </ReviewSection>

      <ReviewSection title="Emergency Contact">
        <ReviewRow label="Name" value={form.emergency_name} />
        <ReviewRow label="Phone" value={form.emergency_phone} />
        <ReviewRow label="Relationship" value={form.emergency_relationship} />
      </ReviewSection>

      <ReviewSection title="Bank Details">
        <ReviewRow label="Bank Name" value={form.bank_name} />
        <ReviewRow label="Account Type" value={form.account_type} />
        <ReviewRow
          label="Account Number"
          value={
            form.account_number
              ? "••••" + form.account_number.slice(-4)
              : undefined
          }
        />
        <ReviewRow label="IFSC Code" value={form.ifsc_code} />
      </ReviewSection>

      <ReviewSection title="Compliance">
        <ReviewRow label="PAN Number" value={form.pan_number} />
        <ReviewRow
          label="Aadhaar Number"
          value={
            form.aadhaar_number
              ? "••••••••" + form.aadhaar_number.slice(-4)
              : undefined
          }
        />
        <ReviewRow label="UAN Number" value={form.uan_number} />
      </ReviewSection>

      <label className="flex items-start gap-3 cursor-pointer group mt-2">
        <div className="mt-0.5 shrink-0">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-[#2E6FE6] focus:ring-[#2E6FE6]/30 cursor-pointer"
            checked={form.declaration}
            onChange={(e) => onDeclarationChange(e.target.checked)}
          />
        </div>
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition">
          I confirm that all the information provided above is accurate and complete to the best of
          my knowledge. I understand that providing false information may result in termination of
          employment.
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-screen state screens
// ---------------------------------------------------------------------------

function CenterScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-border p-8 max-w-md w-full text-center">
        {children}
      </div>
    </div>
  );
}

function ExpiredScreen({ token }: { token?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function renew() {
    if (!token) return;
    setState("sending");
    try {
      const res = await fetch(`${API_BASE}/onboarding/pre-join/${token}/request-new-link`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMsg(body?.message ?? "Couldn't renew the link. Please contact your HR team.");
        return;
      }
      setState("sent");
      setMsg(body?.message ?? "Your link has been renewed.");
      // The same link now works — reopen the form automatically.
      setTimeout(() => window.location.reload(), 1600);
    } catch {
      setState("error");
      setMsg("Network error. Please try again or contact your HR team.");
    }
  }

  return (
    <CenterScreen>
      <div className="mb-4 flex justify-center">
        <div className="h-14 w-14 rounded-full bg-destructive/15 flex items-center justify-center">
          <svg className="h-7 w-7 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Link expired</h2>

      {state === "sent" ? (
        <p className="text-success text-sm">
          {msg} Reopening your form…
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm mb-5">
            This pre-onboarding link has expired. You can renew it instantly below — we'll also email you a fresh copy.
          </p>
          <button
            type="button"
            onClick={renew}
            disabled={state === "sending"}
            className="inline-flex items-center justify-center rounded-lg bg-[#2E6FE6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1A4D8F] active:bg-[#163E72] transition disabled:opacity-60"
          >
            {state === "sending" ? "Renewing…" : "Get a new link"}
          </button>
          {state === "error" && <p className="text-destructive text-xs mt-3">{msg}</p>}
          <p className="text-muted-foreground text-xs mt-4">
            Still stuck? Please contact your HR team.
          </p>
        </>
      )}
    </CenterScreen>
  );
}

function AlreadySubmittedScreen() {
  return (
    <CenterScreen>
      <div className="mb-4 flex justify-center">
        <div className="h-14 w-14 rounded-full bg-warning/15 flex items-center justify-center">
          <svg className="h-7 w-7 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Already submitted</h2>
      <p className="text-muted-foreground text-sm">
        Your details have already been submitted. Our HR team will review your information and get
        in touch with you shortly.
      </p>
    </CenterScreen>
  );
}

function SuccessScreen({ candidateName }: { candidateName?: string }) {
  return (
    <CenterScreen>
      <div className="mb-4 flex justify-center">
        <div className="h-14 w-14 rounded-full bg-success/15 flex items-center justify-center">
          <svg className="h-7 w-7 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        {candidateName ? `Thank you, ${candidateName.split(" ")[0]}!` : "Details submitted!"}
      </h2>
      <p className="text-muted-foreground text-sm">
        Your details have been submitted successfully. Our HR team will review everything and get
        in touch with you soon. We look forward to having you on board!
      </p>
    </CenterScreen>
  );
}

function LoadingScreen() {
  return (
    <CenterScreen>
      <div className="flex justify-center mb-4">
        <svg className="animate-spin h-8 w-8 text-[#2E6FE6]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
      <p className="text-muted-foreground text-sm">Loading your onboarding form...</p>
    </CenterScreen>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

const STEPS = [
  { label: "Personal" },
  { label: "Address" },
  { label: "Bank & Tax" },
  { label: "Experience" },
  { label: "Documents" },
  { label: "Review" },
];

// Step indices (single source of truth for navigation logic).
const STEP_EXPERIENCE = 3;
const STEP_DOCUMENTS = 4;
const STEP_REVIEW = 5;

function ProgressBar({ current }: { current: number }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        {STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={s.label} className="flex flex-col items-center flex-1">
              <div
                className={[
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold mb-1 transition-all",
                  done
                    ? "bg-[#2E6FE6] text-white"
                    : active
                    ? "bg-[#EEF3FB] text-[#2E6FE6] ring-2 ring-[#2E6FE6]"
                    : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {done ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={[
                  "text-xs hidden sm:block",
                  active ? "text-[#2E6FE6] font-medium" : "text-muted-foreground",
                ].join(" ")}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-[#2E6FE6] rounded-full transition-all duration-500"
          style={{ width: `${((current) / (STEPS.length - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents step
// ---------------------------------------------------------------------------

type DocType = "cv" | "pan" | "aadhaar" | "cheque" | "photo";
type UploadStatus = "idle" | "uploading" | "done" | "error";

interface DocSlotDef {
  type: DocType;
  label: string;
  hint: string;
  accept: string;
  required: boolean;
}

const DOC_SLOTS: DocSlotDef[] = [
  { type: "cv", label: "CV / Resume", hint: "PDF or image", accept: ".pdf,image/*", required: true },
  { type: "pan", label: "PAN Card", hint: "PDF or image", accept: ".pdf,image/*", required: true },
  { type: "aadhaar", label: "Aadhaar Card", hint: "PDF or image", accept: ".pdf,image/*", required: true },
  { type: "cheque", label: "Cancelled Cheque", hint: "PDF or image", accept: ".pdf,image/*", required: true },
  { type: "photo", label: "Passport Photo", hint: "Image only", accept: "image/*", required: true },
];

const MANDATORY_DOC_TYPES: DocType[] = ["cv", "pan", "aadhaar", "cheque", "photo"];

interface DocSlotState {
  status: UploadStatus;
  fileName?: string;
  error?: string;
}

function DocSlot({
  def,
  state,
  onSelect,
  flagged,
}: {
  def: DocSlotDef;
  state: DocSlotState;
  onSelect: (file: File) => void;
  flagged?: string;
}) {
  const { status, fileName, error } = state;
  return (
    <div className={[
      "rounded-xl border p-4 flex items-center gap-4",
      flagged ? "border-amber-300 bg-amber-50/60" : "border-border",
    ].join(" ")}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{def.label}</span>
          {def.required && <span className="text-destructive">*</span>}
          {flagged && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Re-upload requested</span>
          )}
        </div>
        {flagged && <p className="text-xs text-amber-700 mt-0.5">{flagged}</p>}
        {status === "done" && fileName ? (
          <p className="text-xs text-success mt-0.5 truncate flex items-center gap-1">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {fileName}
          </p>
        ) : status === "error" ? (
          <p className="text-xs text-destructive mt-0.5 truncate">{error ?? "Upload failed"}</p>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5">{def.hint}</p>
        )}
      </div>

      <div className="shrink-0">
        {status === "uploading" ? (
          <div className="flex items-center gap-2 text-xs text-[#2E6FE6]">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Uploading
          </div>
        ) : (
          <label
            className={[
              "cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold transition inline-block",
              status === "done"
                ? "bg-muted text-muted-foreground hover:bg-muted"
                : status === "error"
                ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
                : "bg-[#2E6FE6] text-white hover:bg-[#1A4D8F]",
            ].join(" ")}
          >
            {status === "done" ? "Replace" : status === "error" ? "Retry" : "Upload"}
            <input
              type="file"
              accept={def.accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSelect(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function DocumentsStep({
  slots,
  onSelect,
  flaggedReasons,
}: {
  slots: Record<DocType, DocSlotState>;
  onSelect: (type: DocType, file: File) => void;
  flaggedReasons?: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      {DOC_SLOTS.map((def) => (
        <DocSlot
          key={def.type}
          def={def}
          state={slots[def.type]}
          onSelect={(file) => onSelect(def.type, file)}
          flagged={flaggedReasons?.[def.type]}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateStep(step: number, form: FormData): string | null {
  if (step === 0) {
    if (!form.first_name.trim()) return "First name is required.";
    if (!form.last_name.trim()) return "Last name is required.";
    if (!form.email.trim()) return "Email is required.";
    if (!form.date_of_birth) return "Date of birth is required.";
    if (!form.gender) return "Gender is required.";
    if (!form.nationality.trim()) return "Nationality is required.";
  }
  if (step === 1) {
    if (!form.address_line1.trim()) return "Address Line 1 is required.";
    if (!form.city.trim()) return "City is required.";
    if (!form.state.trim()) return "State is required.";
    if (!form.pincode.trim() || form.pincode.length !== 6) return "Valid 6-digit pincode is required.";
  }
  if (step === 2) {
    if (!form.bank_name.trim()) return "Bank name is required.";
    if (!form.account_number.trim()) return "Account number is required.";
    if (!form.ifsc_code.trim()) return "IFSC code is required.";
    if (!form.account_type) return "Account type is required.";
    if (!form.pan_number.trim() || form.pan_number.length !== 10)
      return "Valid 10-character PAN number is required.";
  }
  if (step === STEP_REVIEW) {
    if (!form.declaration) return "Please confirm the declaration before submitting.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// API base — same origin/proxy in dev, full Railway URL in production.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export function PreJoinPortal() {
  const { token } = useParams<{ token: string }>();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [meta, setMeta] = useState<OnboardingMeta | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  // HR-provided identity values, kept so we can flag candidate edits.
  const [prefilled, setPrefilled] = useState<Partial<Record<IdentityKey, string>>>({});
  // Candidate-declared previous employment (optional; freshers leave empty).
  const [prevEmployers, setPrevEmployers] = useState<PrevEmployer[]>([]);
  // Candidate-declared education (optional; each may carry a certificate upload).
  const [eduEntries, setEduEntries] = useState<EduEntry[]>([]);
  // Set when HR sent the form back for re-upload: [{ document_type, reason }].
  const [requestedChanges, setRequestedChanges] = useState<{ document_type: string; reason: string }[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [docSlots, setDocSlots] = useState<Record<DocType, DocSlotState>>({
    cv: { status: "idle" },
    pan: { status: "idle" },
    aadhaar: { status: "idle" },
    cheque: { status: "idle" },
    photo: { status: "idle" },
  });

  const uploadedDocs = new Set<DocType>(
    (Object.keys(docSlots) as DocType[]).filter((t) => docSlots[t].status === "done"),
  );
  const allMandatoryUploaded = MANDATORY_DOC_TYPES.every((t) => uploadedDocs.has(t));

  // ---- Fetch token info on mount ----
  useEffect(() => {
    if (!token) {
      setPageState("expired");
      return;
    }
    fetch(`${API_BASE}/onboarding/pre-join/${token}`)
      .then(async (res) => {
        if (res.status === 404 || res.status === 410) {
          setPageState("expired");
          return;
        }
        if (!res.ok) {
          setPageState("expired");
          return;
        }
        const data = await res.json();
        if (data.status === "submitted") {
          setPageState("already_submitted");
          return;
        }
        setMeta({
          company_name: data.company_name ?? "the company",
          joining_date: data.joining_date ?? "",
          candidate_name: data.candidate_name ?? "",
        });
        // Seed the HR-prefilled identity/role fields into the form, and remember
        // the originals so we can flag any field the candidate edits.
        const identity: Partial<Record<IdentityKey, string>> = {
          first_name:   data.first_name ?? "",
          last_name:    data.last_name ?? "",
          email:        data.email ?? "",
          phone:        data.phone ?? "",
          designation:  data.designation ?? "",
          department:   data.department ?? "",
          joining_date: data.joining_date ?? "",
        };
        setForm((prev) => ({ ...prev, ...identity }));
        setPrefilled(identity);

        // Re-opened for re-upload: pre-fill the candidate's prior submission so
        // they only revise what's flagged, and show which documents to redo.
        if (data.status === "changes_requested") {
          setRequestedChanges(Array.isArray(data.requested_changes) ? data.requested_changes : []);
          const s = data.submission;
          if (s) {
            setForm((prev) => ({
              ...prev,
              date_of_birth:          s.dob ?? "",
              gender:                 s.gender ?? "",
              blood_group:            s.blood_group ?? "",
              marital_status:         s.marital_status ?? "",
              nationality:            s.nationality ?? "",
              address_line1:          s.address_line1 ?? "",
              address_line2:          s.address_line2 ?? "",
              city:                   s.city ?? "",
              state:                  s.state ?? "",
              pincode:                s.pincode ?? "",
              emergency_name:         s.emergency_name ?? "",
              emergency_phone:        s.emergency_phone ?? "",
              emergency_relationship: s.emergency_relation ?? "",
              bank_name:              s.bank_name ?? "",
              account_number:         s.account_number ?? "",
              ifsc_code:              s.ifsc ?? "",
              account_type:           s.account_type ?? "",
              pan_number:             s.pan ?? "",
              aadhaar_number:         s.aadhaar ?? "",
              uan_number:             s.uan ?? "",
            }));
            if (Array.isArray(s.previous_employment)) {
              setPrevEmployers(s.previous_employment.map((e: any) => ({
                company_name:       e.company_name ?? "",
                designation:        e.designation ?? "",
                from_date:          e.from_date ?? "",
                to_date:            e.to_date ?? "",
                last_ctc:           e.last_ctc != null ? String(e.last_ctc) : "",
                reason_for_leaving: e.reason_for_leaving ?? "",
              })));
            }
            if (Array.isArray(s.education)) {
              setEduEntries(s.education.map((e: any) => ({
                qualification:      e.qualification ?? "",
                institution:        e.institution ?? "",
                specialization:     e.specialization ?? "",
                year_of_completion: e.year_of_completion != null ? String(e.year_of_completion) : "",
                grade:              e.grade ?? "",
                document_path:      e.document_path ?? undefined,
                document_name:      e.document_name ?? undefined,
              })));
            }
          }
          const uploaded: string[] = Array.isArray(data.uploaded_documents) ? data.uploaded_documents : [];
          if (uploaded.length) {
            setDocSlots((prev) => {
              const next = { ...prev };
              for (const t of uploaded) {
                if (t in next) next[t as DocType] = { status: "done", fileName: "Previously uploaded" };
              }
              return next;
            });
          }
        }

        setPageState("form");
      })
      .catch(() => setPageState("expired"));
  }, [token]);

  // ---- Field change handler ----
  function handleChange(key: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  // ---- Document upload (signed URL flow) ----
  async function handleDocUpload(type: DocType, file: File) {
    setError(null);
    setDocSlots((prev) => ({ ...prev, [type]: { status: "uploading", fileName: file.name } }));
    try {
      // 1. Request a signed upload URL
      const urlRes = await fetch(`${API_BASE}/onboarding/pre-join/${token}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_type: type, file_name: file.name }),
      });
      if (!urlRes.ok) throw new Error("Could not start upload");
      const { data: urlData } = await urlRes.json();
      const path: string = urlData.path;
      const uploadToken: string = urlData.token;

      // 2. Upload the file directly to storage via the official signed-URL helper
      //    (robust across CORS / Content-Type vs a raw PUT)
      await uploadToSignedUrl(path, uploadToken, file);

      // 3. Register the document
      const regRes = await fetch(`${API_BASE}/onboarding/pre-join/${token}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: type,
          file_name: file.name,
          storage_path: path,
          mime_type: file.type,
          file_size: file.size,
        }),
      });
      if (!regRes.ok) throw new Error("Could not save document");

      setDocSlots((prev) => ({ ...prev, [type]: { status: "done", fileName: file.name } }));
    } catch (e) {
      setDocSlots((prev) => ({
        ...prev,
        [type]: { status: "error", fileName: file.name, error: e instanceof Error ? e.message : "Upload failed" },
      }));
    }
  }

  // ---- Education certificate upload (signed-URL flow, stored on the entry) ----
  async function uploadEducationCert(file: File): Promise<{ path: string; name: string }> {
    const urlRes = await fetch(`${API_BASE}/onboarding/pre-join/${token}/upload-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_type: "education", file_name: file.name }),
    });
    if (!urlRes.ok) throw new Error("Could not start upload");
    const { data: urlData } = await urlRes.json();
    await uploadToSignedUrl(urlData.path, urlData.token, file);
    return { path: urlData.path, name: file.name };
  }

  async function handleEduFile(i: number, file: File) {
    setEduEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, uploading: true, uploadError: undefined } : e)));
    try {
      const { path, name } = await uploadEducationCert(file);
      setEduEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, uploading: false, document_path: path, document_name: name } : e)));
    } catch (err) {
      setEduEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, uploading: false, uploadError: err instanceof Error ? err.message : "Upload failed" } : e)));
    }
  }

  // ---- Navigation ----
  function handleNext() {
    const err = validateStep(currentStep, form);
    if (err) {
      setError(err);
      return;
    }
    if (currentStep === STEP_DOCUMENTS && !allMandatoryUploaded) {
      setError(`All ${MANDATORY_DOC_TYPES.length} required documents must be uploaded to continue.`);
      return;
    }
    setError(null);
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    setError(null);
    setCurrentStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- Submit ----
  async function handleSubmit() {
    const err = validateStep(STEP_REVIEW, form);
    if (err) {
      setError(err);
      return;
    }
    if (!allMandatoryUploaded) {
      setError(`All ${MANDATORY_DOC_TYPES.length} required documents must be uploaded before submitting.`);
      return;
    }
    if (eduEntries.some((e) => e.uploading)) {
      setError("Please wait for certificate uploads to finish.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/onboarding/pre-join/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          edited_fields: editedIdentityFields(form, prefilled),
          previous_employment: prevEmployers.filter((e) => e.company_name.trim()),
          education: eduEntries
            .filter((e) => e.qualification.trim())
            .map(({ qualification, institution, specialization, year_of_completion, grade, document_path, document_name }) => ({
              qualification, institution, specialization, year_of_completion, grade, document_path, document_name,
            })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Submission failed. Please try again.");
        return;
      }
      setPageState("success");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Render states ----
  if (pageState === "loading") return <LoadingScreen />;
  if (pageState === "expired") return <ExpiredScreen token={token} />;
  if (pageState === "already_submitted") return <AlreadySubmittedScreen />;
  if (pageState === "success") return <SuccessScreen candidateName={meta?.candidate_name} />;

  // ---- Format joining date ----
  const joiningDateFormatted = meta?.joining_date
    ? new Date(meta.joining_date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <div className="min-h-screen bg-muted">
      {/* Top bar */}
      <header className="bg-white border-b border-border shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <LogoMark size={36} tile />
          <div className="flex flex-col leading-tight">
            <Wordmark height={14} />
            <span className="text-[10px] text-muted-foreground mt-0.5">
              {meta?.company_name ?? brandConfig.productName}
            </span>
          </div>
          <span className="ml-auto text-xs text-muted-foreground hidden sm:block">
            Pre-Join Portal
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Changes-requested banner — shown on every step until resubmitted */}
        {requestedChanges.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-800">Action needed — please update the following</p>
                <p className="text-xs text-amber-700 mt-0.5">Your details are saved. Revise what's flagged below and resubmit.</p>
                <ul className="mt-3 space-y-1.5">
                  {requestedChanges.map((c, i) => (
                    <li key={i} className="text-sm text-amber-900">
                      <span className="font-medium capitalize">{c.document_type.replace(/_/g, " ")}</span>
                      <span className="text-amber-700"> — {c.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Welcome banner — only step 0 */}
        {currentStep === 0 && (
          <div className="rounded-2xl p-6 mb-6 text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${brandConfig.colors.primary} 0%, ${brandConfig.colors.navy} 100%)` }}>
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.82m5.84-2.56a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.82m2.56-5.84a14.98 14.98 0 00-2.58 5.84m0 0a14.98 14.98 0 01-5.96 5.96" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold leading-snug">
                  Welcome to {meta?.company_name ?? "the team"}
                  {meta?.candidate_name ? `, ${meta.candidate_name.split(" ")[0]}` : ""}!
                </h1>
                {joiningDateFormatted && (
                  <p className="text-white/75 text-sm mt-1">
                    We are excited to have you joining us on{" "}
                    <span className="text-white font-semibold">{joiningDateFormatted}</span>.
                  </p>
                )}
                <p className="text-white/75 text-sm mt-2">
                  Please take a few minutes to fill in your details below. This helps us get
                  everything ready for your first day.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-border p-6 sm:p-8">
          {/* Progress */}
          <div className="mb-8">
            <ProgressBar current={currentStep} />
          </div>

          {/* Step title */}
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {currentStep === 0 && "Personal Information"}
            {currentStep === 1 && "Address & Emergency Contact"}
            {currentStep === 2 && "Bank & Compliance Details"}
            {currentStep === STEP_EXPERIENCE && "Experience & Education"}
            {currentStep === STEP_DOCUMENTS && "Documents"}
            {currentStep === STEP_REVIEW && "Review & Submit"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {currentStep === 0 && "Tell us a bit about yourself."}
            {currentStep === 1 && "Your current address and someone we can contact in emergencies."}
            {currentStep === 2 && "Needed for salary processing and statutory compliance."}
            {currentStep === STEP_EXPERIENCE && "Add your prior work experience and education. Skip experience if you are a fresher."}
            {currentStep === STEP_DOCUMENTS && "Upload the required documents below."}
            {currentStep === STEP_REVIEW && "Please review all your details before submitting."}
          </p>

          {/* Step content */}
          {currentStep === 0 && (
            <>
              <IdentitySection form={form} prefilled={prefilled} onChange={handleChange} />
              <Step1 form={form} onChange={handleChange} />
            </>
          )}
          {currentStep === 1 && <Step2 form={form} onChange={handleChange} />}
          {currentStep === 2 && <Step3 form={form} onChange={handleChange} />}
          {currentStep === STEP_EXPERIENCE && (
            <div className="space-y-8">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Previous Employment</h3>
                <PrevEmploymentSection employers={prevEmployers} onChange={setPrevEmployers} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3">Education</h3>
                <EducationSection entries={eduEntries} onChange={setEduEntries} onFileSelect={handleEduFile} />
              </div>
            </div>
          )}
          {currentStep === STEP_DOCUMENTS && (
            <>
              <DocumentsStep
                slots={docSlots}
                onSelect={handleDocUpload}
                flaggedReasons={Object.fromEntries(requestedChanges.map((c) => [c.document_type, c.reason]))}
              />
              <p
                className={[
                  "text-xs mt-4",
                  allMandatoryUploaded ? "text-success" : "text-muted-foreground",
                ].join(" ")}
              >
                All {MANDATORY_DOC_TYPES.length} required documents must be uploaded to continue.
              </p>
            </>
          )}
          {currentStep === STEP_REVIEW && (
            <Step4
              form={form}
              onDeclarationChange={(v) =>
                setForm((prev) => ({ ...prev, declaration: v }))
              }
            />
          )}

          {/* Error */}
          {error && (
            <div className="mt-5 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3">
              <svg className="h-4 w-4 text-destructive shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-sm text-destructive">{error}</span>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBack}
              disabled={currentStep === 0}
              className={[
                "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
                currentStep === 0
                  ? "invisible"
                  : "bg-muted text-muted-foreground hover:bg-muted active:bg-muted",
              ].join(" ")}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>

            {currentStep < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={currentStep === STEP_DOCUMENTS && !allMandatoryUploaded}
                className={[
                  "ml-auto flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition",
                  currentStep === STEP_DOCUMENTS && !allMandatoryUploaded
                    ? "bg-[#2E6FE6]/40 cursor-not-allowed"
                    : "bg-[#2E6FE6] hover:bg-[#1A4D8F] active:bg-[#163E72]",
                ].join(" ")}
              >
                Continue
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !form.declaration || !allMandatoryUploaded}
                className={[
                  "ml-auto flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition",
                  submitting || !form.declaration || !allMandatoryUploaded
                    ? "bg-[#2E6FE6]/40 cursor-not-allowed"
                    : "bg-[#2E6FE6] hover:bg-[#1A4D8F] active:bg-[#163E72]",
                ].join(" ")}
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Submitting...
                  </>
                ) : (
                  <>
                    Submit Details
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 pb-8">
          {brandConfig.portalHelpText}
        </p>
      </main>
    </div>
  );
}

export default PreJoinPortal;
