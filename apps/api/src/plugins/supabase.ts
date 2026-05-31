import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import ws from 'ws'

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseClient
  }
}

const supabasePlugin: FastifyPluginAsync = async (fastify) => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  })

  fastify.decorate('supabase', client)
}

export default fp(supabasePlugin, { name: 'supabase' })
