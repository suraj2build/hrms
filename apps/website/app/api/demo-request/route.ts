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

    // Insert into signup_requests — visible in Owner Portal
    const { error } = await supabase
      .from('signup_requests')
      .insert({
        contact_name:    name,
        contact_email:   email,
        company_name:    company,
        phone:           phone   || null,
        employee_count:  size    || null,
        notes:           message || null,
        status:          'pending',
        source:          'website_demo_form',
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
