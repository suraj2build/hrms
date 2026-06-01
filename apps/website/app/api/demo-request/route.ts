import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, email, company, phone, size, message } = body

    if (!name || !email || !company) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Insert into tenant_signup_requests — visible in Owner Portal → Requests tab
    const { error } = await supabase
      .from('tenant_signup_requests')
      .insert({
        contact_name:  name,
        contact_email: email,
        company_name:  company,
        size_range:    size    || null,
        message:       [phone ? `Phone: ${phone}` : '', message || ''].filter(Boolean).join('\n') || null,
        status:        'pending',
        country:       'IN',
      })

    if (error) {
      console.error('Demo request insert failed:', error.message)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Demo request error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
