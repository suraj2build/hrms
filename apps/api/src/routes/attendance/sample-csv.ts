/**
 * GET /attendance/sample-csv
 *
 * Returns a downloadable CSV with the expected column headers and
 * sample rows for the attendance bulk-upload feature.
 *
 * New format (single-column datetime):
 *   employee_code — must match an active employee in the tenant
 *   datetime      — YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS (tenant local time)
 *   source        — optional; defaults to "csv_upload"
 *
 * Each row is ONE punch event. The server groups punches by (employee, date),
 * sorts by time, and assigns direction: 1st=IN, 2nd=OUT, 3rd=IN, 4th=OUT…
 *
 * Auth: any authenticated user (hr_admin / super_admin in practice).
 */
import type { FastifyInstance } from 'fastify'

export default async function attendanceSampleCsvRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/attendance/sample-csv', auth, async (_req, reply) => {
    const today     = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

    const lines = [
      'employee_code,datetime,source',
      // EMP001 today: IN then OUT
      `EMP001,${today} 09:00:00,csv_upload`,
      `EMP001,${today} 18:00:00,csv_upload`,
      // EMP002 today: IN then OUT
      `EMP002,${today} 08:45:00,csv_upload`,
      `EMP002,${today} 17:30:00,csv_upload`,
      // EMP001 yesterday
      `EMP001,${yesterday} 09:15:00,csv_upload`,
      `EMP001,${yesterday} 18:30:00,csv_upload`,
      // Night-shift example: IN yesterday evening, OUT today morning
      `EMP003,${yesterday} 22:00:00,csv_upload`,
      `EMP003,${today} 06:00:00,csv_upload`,
    ]

    const csv = lines.join('\r\n') + '\r\n'

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="attendance_upload_sample.csv"')
      .header('Cache-Control', 'no-store')
      .send(csv)
  })
}
