/**
 * AuthShowcase — the branded right-hand panel shared by Login and Signup.
 * Navy brand gradient with floating glassy 3D HR cards.
 */
import { Users, Wallet, CalendarCheck, TrendingUp } from 'lucide-react'
import { LogoMark, Wordmark } from '@/components/brand/Logo'

export function FloatKeyframes() {
  // Animate the `translate` property (independent of `transform`) so the cards'
  // rotation is preserved while they gently float.
  return (
    <style>{`
      @keyframes emv-float {
        0%, 100% { translate: 0 0; }
        50%      { translate: 0 -10px; }
      }
      @media (prefers-reduced-motion: reduce) {
        [style*="emv-float"] { animation: none !important; }
      }
    `}</style>
  )
}

export function AuthShowcase() {
  return (
    <div className="relative hidden overflow-hidden lg:block">
      {/* Navy brand gradient */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(150deg, #0E2A4E 0%, #1A4D8F 52%, #11335E 100%)' }}
      />
      {/* Soft grid + glow */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(120% 90% at 70% 20%, #000 30%, transparent 80%)',
        }}
      />
      <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#3B82F6]/30 blur-3xl" />
      <div className="absolute bottom-10 left-0 h-72 w-72 rounded-full bg-[#1A8050]/20 blur-3xl" />

      {/* Content */}
      <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
        {/* Floating glassy card stack */}
        <div className="relative mx-auto mt-2 h-[360px] w-full max-w-[460px] [perspective:1400px]">
          {/* Workforce donut card (back) */}
          <GlassCard className="absolute left-2 top-0 w-[270px] [transform:rotate(-5deg)]" floatDelay="0s">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/70">Workforce Overview</p>
              <Users className="h-3.5 w-3.5 text-white/60" />
            </div>
            <p className="mt-1 text-2xl font-bold text-white">248 <span className="text-sm font-medium text-white/60">employees</span></p>
            <div className="mt-3 flex items-center gap-4">
              <Donut />
              <div className="space-y-1.5 text-[11px]">
                <Legend color="#FFFFFF" label="Engineering" val="42%" />
                <Legend color="rgba(255,255,255,.6)" label="Operations" val="33%" />
                <Legend color="rgba(255,255,255,.32)" label="Sales & Other" val="25%" />
              </div>
            </div>
          </GlassCard>

          {/* Leave card (top-right) */}
          <GlassCard className="absolute right-0 top-8 w-[210px] [transform:rotate(4deg)]" floatDelay="1.1s">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/70">Leave & Attendance</p>
              <CalendarCheck className="h-3.5 w-3.5 text-white/60" />
            </div>
            <div className="mt-2 flex items-end justify-between">
              <div>
                <p className="text-xl font-bold text-white">96.4%</p>
                <p className="text-[10px] text-white/55">Attendance today</p>
              </div>
              <div className="text-right">
                <p className="text-base font-semibold text-emerald-300">12</p>
                <p className="text-[10px] text-white/55">On leave</p>
              </div>
            </div>
            <div className="mt-3 flex h-7 items-end gap-1">
              {[60, 80, 45, 90, 70, 96, 84].map((h, i) => (
                <span key={i} className="flex-1 rounded-sm bg-white/30" style={{ height: `${h}%` }} />
              ))}
            </div>
          </GlassCard>

          {/* Payroll card (front center) */}
          <GlassCard className="absolute left-1/2 bottom-0 w-[300px] [transform:translateX(-50%)_rotate(-2deg)]" floatDelay="0.5s" front>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/70">Payroll · June 2026</p>
              <Wallet className="h-3.5 w-3.5 text-white/60" />
            </div>
            <p className="mt-1 text-2xl font-bold text-white">₹ 48.2L</p>
            <div className="mt-3 space-y-2">
              <PayLine label="Basic + DA" val="₹ 28.4L" pct={62} />
              <PayLine label="Allowances · HRA" val="₹ 12.9L" pct={28} />
              <PayLine label="PF · ESI · Tax" val="₹ 6.9L" pct={14} />
            </div>
            <button className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/15 py-2 text-[11px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-sm">
              <TrendingUp className="h-3 w-3" /> Run finalized · ready to disburse
            </button>
          </GlassCard>
        </div>

        {/* Tagline */}
        <div className="max-w-[440px]">
          <div className="mb-4 flex items-center gap-3">
            <LogoMark size={48} tile />
            <div className="leading-none">
              <Wordmark height={22} tone="light" />
              <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.2em] text-white/55">Smarter Workforce · Stronger Future</p>
            </div>
          </div>
          <h2 className="text-2xl font-bold leading-tight text-white xl:text-[28px]">
            A Unified Hub for Smarter<br />Workforce Decisions
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/65">
            CognixHR gives HR, payroll and people teams a single command center —
            deep insights, statutory compliance and a 360° view of your entire workforce.
          </p>
          <div className="mt-6 flex items-center gap-1.5">
            <span className="h-1.5 w-6 rounded-full bg-white" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Building blocks ─────────────────────────────────────────────────────────────

function GlassCard({
  children, className, floatDelay = '0s', front = false,
}: {
  children: React.ReactNode; className?: string; floatDelay?: string; front?: boolean
}) {
  return (
    <div
      className={
        'rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl ' +
        'shadow-[0_25px_60px_-15px_rgba(0,0,0,0.55)] ring-1 ring-white/10 ' +
        (front ? 'z-20 ' : 'z-10 ') + (className ?? '')
      }
      style={{ animation: `emv-float 6s ease-in-out ${floatDelay} infinite` }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-t-2xl bg-gradient-to-b from-white/20 to-transparent" />
      <div className="relative">{children}</div>
    </div>
  )
}

function Donut() {
  return (
    <div className="relative h-16 w-16 flex-shrink-0">
      <div
        className="h-16 w-16 rounded-full"
        style={{
          background:
            'conic-gradient(#FFFFFF 0 42%, rgba(255,255,255,.6) 42% 75%, rgba(255,255,255,.32) 75% 100%)',
        }}
      />
      <div className="absolute inset-[22%] rounded-full bg-[#163F75]/90 backdrop-blur-sm" />
    </div>
  )
}

function Legend({ color, label, val }: { color: string; label: string; val: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-white/70">{label}</span>
      <span className="ml-auto font-semibold text-white/85">{val}</span>
    </div>
  )
}

function PayLine({ label, val, pct }: { label: string; val: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/70">{label}</span>
        <span className="font-semibold text-white/90">{val}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/15">
        <span className="block h-full rounded-full bg-white/70" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
