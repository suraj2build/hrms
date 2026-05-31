/**
 * GET /attendance/sample-csv
 *
 * Returns a downloadable CSV file with the expected column headers and
 * 3 illustrative sample rows for the attendance bulk-upload feature.
 *
 * Columns:
 *   employee_code — must match an active employee in the tenant
 *   date          — YYYY-MM-DD
 *   in_time       — HH:MM or HH:MM:SS  (treated as UTC; adjust for your timezone)
 *   out_time      — HH:MM or HH:MM:SS
 *   source        — optional; defaults to "csv_upload"
 *
 * Auth: any authenticated user (hr_admin / super_admin in practice).
 */
import type { FastifyInstance } from 'fastify'

export default async function attendanceSampleCsvRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/attendance/sample-csv', auth, async (_req, reply) => {
    const today     = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const twoDays   = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)

    const lines = [
      'employee_code,date,in_time,out_time,source',
      `EMP001,${today},09:00,18:00,csv_upload`,
      `EMP002,${today},08:45,17:30,csv_upload`,
      `EMP001,${yesterday},09:15,18:30,csv_upload`,
      `EMP003,${twoDays},10:00,19:00,csv_upload`,
    ]

    const csv = lines.join('\r\n') + '\r\n'

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="attendance_upload_sample.csv"')
      .header('Cache-Control', 'no-store')
      .send(csv)
  })
}
