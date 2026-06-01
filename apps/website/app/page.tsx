import Nav         from '@/components/Nav'
import Hero        from '@/components/Hero'
import Personas    from '@/components/Personas'
import Features    from '@/components/Features'
import Intelligence from '@/components/Intelligence'
import Compliance  from '@/components/Compliance'
import Integrations from '@/components/Integrations'
import Security    from '@/components/Security'
import Pricing     from '@/components/Pricing'
import Comparison  from '@/components/Comparison'
import DemoForm    from '@/components/DemoForm'
import Footer      from '@/components/Footer'

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-white">
      <Nav />
      <Hero />
      <Personas />
      <Features />
      <Intelligence />
      <Compliance />
      <Integrations />
      <Security />
      <Pricing />
      <Comparison />
      <DemoForm />
      <Footer />
    </main>
  )
}
