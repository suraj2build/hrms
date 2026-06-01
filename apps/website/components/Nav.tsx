'use client'
import { useState, useEffect } from 'react'
import { Menu, X, Zap } from 'lucide-react'

const links = [
  { label: 'Features',   href: '#features'   },
  { label: 'Intelligence', href: '#intelligence' },
  { label: 'Compliance', href: '#compliance'  },
  { label: 'Pricing',    href: '#pricing'     },
  { label: 'Compare',    href: '#compare'     },
]

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open,     setOpen]     = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled ? 'glass-dark shadow-lg shadow-black/20' : 'bg-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center shadow-lg glow-violet">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-lg text-white tracking-tight">emvora</span>
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {links.map(l => (
            <a key={l.href} href={l.href}
              className="text-sm text-violet-200/70 hover:text-white transition-colors duration-200 font-medium">
              {l.label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a href="#demo"
            className="text-sm font-semibold px-5 py-2 rounded-full bg-gradient-to-r from-violet-600 to-violet-700 text-white hover:from-violet-500 hover:to-violet-600 transition-all duration-200 shadow-lg shadow-violet-900/50">
            Request Demo
          </a>
        </div>

        {/* Mobile menu toggle */}
        <button className="md:hidden text-violet-200" onClick={() => setOpen(!open)}>
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden glass-dark border-t border-violet-800/30 px-6 py-4 space-y-3">
          {links.map(l => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}
              className="block text-sm text-violet-200/80 hover:text-white py-2 font-medium">
              {l.label}
            </a>
          ))}
          <a href="#demo" onClick={() => setOpen(false)}
            className="block text-center text-sm font-semibold px-5 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-violet-700 text-white mt-2">
            Request Demo
          </a>
        </div>
      )}
    </nav>
  )
}
