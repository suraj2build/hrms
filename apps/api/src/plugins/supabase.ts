import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require('ws')

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
    realtime: { transport: ws },
  })

  fastify.decorate('supabase', client)
}

export default fp(supabasePlugin, { name: 'supabase' })
