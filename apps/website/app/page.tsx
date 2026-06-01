import Nav         from '@/components/Nav'
import Hero        from '@/components/Hero'
import Features    from '@/components/Features'
import Intelligence from '@/components/Intelligence'
import Compliance  from '@/components/Compliance'
import Pricing     from '@/components/Pricing'
import Comparison  from '@/components/Comparison'
import DemoForm    from '@/components/DemoForm'
import Footer      from '@/components/Footer'

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-x-hidden">
      <Nav />
      <Hero />
      <Features />
      <Intelligence />
      <Compliance />
      <Pricing />
      <Comparison />
      <DemoForm />
      <Footer />
    </main>
  )
}
