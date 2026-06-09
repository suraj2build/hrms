import type { FastifyInstance } from 'fastify'
import headcountDataset  from './headcount.js'
import attendanceDataset from './attendance.js'
import statutoryDataset  from './statutory.js'
import payrollCostDataset from './payroll-cost.js'

export default async function datasetsRoutes(fastify: FastifyInstance) {
  await fastify.register(headcountDataset,   { prefix: '/headcount'    })
  await fastify.register(attendanceDataset,  { prefix: '/attendance'   })
  await fastify.register(statutoryDataset,   { prefix: '/statutory'    })
  await fastify.register(payrollCostDataset, { prefix: '/payroll-cost' })
}
