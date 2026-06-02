import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { uploadToSignedUrl } from "@/lib/supabase-storage";

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
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 transition";

const selectClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 bg-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 transition";

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
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
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
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
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
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
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
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
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
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 shrink-0 w-44">{label}</span>
      <span className="text-sm text-gray-900 text-right font-medium">{value}</span>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 space-y-0">
      <h4 className="text-xs font-semibold text-violet-600 uppercase tracking-wider mb-3">
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
            className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
            checked={form.declaration}
            onChange={(e) => onDeclarationChange(e.target.checked)}
          />
        </div>
        <span className="text-sm text-gray-600 group-hover:text-gray-800 transition">
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
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 max-w-md w-full text-center">
        {children}
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600 text-white text-xl font-bold shadow-md">
      E
    </div>
  );
}

function ExpiredScreen() {
  return (
    <CenterScreen>
      <div className="mb-4 flex justify-center">
        <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center">
          <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Link expired or invalid</h2>
      <p className="text-gray-500 text-sm">
        This pre-onboarding link is no longer valid. Please contact your HR team for a new link.
      </p>
    </CenterScreen>
  );
}

function AlreadySubmittedScreen() {
  return (
    <CenterScreen>
      <div className="mb-4 flex justify-center">
        <div className="h-14 w-14 rounded-full bg-amber-100 flex items-center justify-center">
          <svg className="h-7 w-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Already submitted</h2>
      <p className="text-gray-500 text-sm">
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
        <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="h-7 w-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">
        {candidateName ? `Thank you, ${candidateName.split(" ")[0]}!` : "Details submitted!"}
      </h2>
      <p className="text-gray-500 text-sm">
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
        <svg className="animate-spin h-8 w-8 text-violet-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
      <p className="text-gray-400 text-sm">Loading your onboarding form...</p>
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
  { label: "Documents" },
  { label: "Review" },
];

// Step indices (single source of truth for navigation logic).
const STEP_DOCUMENTS = 3;
const STEP_REVIEW = 4;

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
                    ? "bg-violet-600 text-white"
                    : active
                    ? "bg-violet-100 text-violet-700 ring-2 ring-violet-500"
                    : "bg-gray-100 text-gray-400",
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
                  active ? "text-violet-700 font-medium" : "text-gray-400",
                ].join(" ")}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-violet-600 rounded-full transition-all duration-500"
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
  { type: "photo", label: "Passport Photo", hint: "Image only (optional)", accept: "image/*", required: false },
];

const MANDATORY_DOC_TYPES: DocType[] = ["cv", "pan", "aadhaar", "cheque"];

interface DocSlotState {
  status: UploadStatus;
  fileName?: string;
  error?: string;
}

function DocSlot({
  def,
  state,
  onSelect,
}: {
  def: DocSlotDef;
  state: DocSlotState;
  onSelect: (file: File) => void;
}) {
  const { status, fileName, error } = state;
  return (
    <div className="rounded-xl border border-gray-200 p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800">{def.label}</span>
          {def.required && <span className="text-red-500">*</span>}
        </div>
        {status === "done" && fileName ? (
          <p className="text-xs text-green-600 mt-0.5 truncate flex items-center gap-1">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {fileName}
          </p>
        ) : status === "error" ? (
          <p className="text-xs text-red-500 mt-0.5 truncate">{error ?? "Upload failed"}</p>
        ) : (
          <p className="text-xs text-gray-400 mt-0.5">{def.hint}</p>
        )}
      </div>

      <div className="shrink-0">
        {status === "uploading" ? (
          <div className="flex items-center gap-2 text-xs text-violet-600">
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
                ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                : status === "error"
                ? "bg-red-50 text-red-600 hover:bg-red-100"
                : "bg-violet-600 text-white hover:bg-violet-700",
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
}: {
  slots: Record<DocType, DocSlotState>;
  onSelect: (type: DocType, file: File) => void;
}) {
  return (
    <div className="space-y-3">
      {DOC_SLOTS.map((def) => (
        <DocSlot
          key={def.type}
          def={def}
          state={slots[def.type]}
          onSelect={(file) => onSelect(def.type, file)}
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

  // ---- Navigation ----
  function handleNext() {
    const err = validateStep(currentStep, form);
    if (err) {
      setError(err);
      return;
    }
    if (currentStep === STEP_DOCUMENTS && !allMandatoryUploaded) {
      setError("All 4 required documents must be uploaded to continue.");
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
      setError("All 4 required documents must be uploaded before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/onboarding/pre-join/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
  if (pageState === "expired") return <ExpiredScreen />;
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
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-violet-600 flex items-center justify-center text-white text-sm font-bold shadow">
            E
          </div>
          <span className="text-gray-900 font-semibold text-sm">
            {meta?.company_name ?? "Company"}
          </span>
          <span className="ml-auto text-xs text-gray-400 hidden sm:block">
            Pre-Join Portal
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Welcome banner — only step 0 */}
        {currentStep === 0 && (
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 rounded-2xl p-6 mb-6 text-white shadow-lg">
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
                  <p className="text-violet-200 text-sm mt-1">
                    We are excited to have you joining us on{" "}
                    <span className="text-white font-semibold">{joiningDateFormatted}</span>.
                  </p>
                )}
                <p className="text-violet-200 text-sm mt-2">
                  Please take a few minutes to fill in your details below. This helps us get
                  everything ready for your first day.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {/* Progress */}
          <div className="mb-8">
            <ProgressBar current={currentStep} />
          </div>

          {/* Step title */}
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {currentStep === 0 && "Personal Information"}
            {currentStep === 1 && "Address & Emergency Contact"}
            {currentStep === 2 && "Bank & Compliance Details"}
            {currentStep === 3 && "Documents"}
            {currentStep === 4 && "Review & Submit"}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {currentStep === 0 && "Tell us a bit about yourself."}
            {currentStep === 1 && "Your current address and someone we can contact in emergencies."}
            {currentStep === 2 && "Needed for salary processing and statutory compliance."}
            {currentStep === 3 && "Upload the required documents below."}
            {currentStep === 4 && "Please review all your details before submitting."}
          </p>

          {/* Step content */}
          {currentStep === 0 && <Step1 form={form} onChange={handleChange} />}
          {currentStep === 1 && <Step2 form={form} onChange={handleChange} />}
          {currentStep === 2 && <Step3 form={form} onChange={handleChange} />}
          {currentStep === 3 && (
            <>
              <DocumentsStep slots={docSlots} onSelect={handleDocUpload} />
              <p
                className={[
                  "text-xs mt-4",
                  allMandatoryUploaded ? "text-green-600" : "text-gray-500",
                ].join(" ")}
              >
                All 4 required documents must be uploaded to continue.
              </p>
            </>
          )}
          {currentStep === 4 && (
            <Step4
              form={form}
              onDeclarationChange={(v) =>
                setForm((prev) => ({ ...prev, declaration: v }))
              }
            />
          )}

          {/* Error */}
          {error && (
            <div className="mt-5 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <svg className="h-4 w-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="text-sm text-red-700">{error}</span>
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
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300",
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
                    ? "bg-violet-300 cursor-not-allowed"
                    : "bg-violet-600 hover:bg-violet-700 active:bg-violet-800",
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
                    ? "bg-violet-300 cursor-not-allowed"
                    : "bg-violet-600 hover:bg-violet-700 active:bg-violet-800",
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

        <p className="text-center text-xs text-gray-400 mt-6 pb-8">
          Having trouble? Contact your HR team for assistance.
        </p>
      </main>
    </div>
  );
}

export default PreJoinPortal;
