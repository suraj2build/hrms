import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Emvora — Workforce Intelligence Platform',
  description: 'Beyond HR. Workforce Intelligence. The AI-native HRMS built for modern Indian enterprises — payroll, attendance, compliance, and intelligence in one platform.',
  keywords: 'HRMS, HR software, payroll software, attendance management, workforce intelligence, EPF, ESI, TDS, India HR',
  openGraph: {
    title: 'Emvora — Workforce Intelligence Platform',
    description: 'Beyond HR. Workforce Intelligence.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body>{children}</body>
    </html>
  )
}
