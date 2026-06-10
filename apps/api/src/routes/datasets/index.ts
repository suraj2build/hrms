import type { FastifyInstance } from 'fastify'
import headcountDataset    from './headcount.js'
import attendanceDataset   from './attendance.js'
import statutoryDataset    from './statutory.js'
import payrollCostDataset  from './payroll-cost.js'
import employeesDataset    from './employees.js'
import leaveDataset        from './leave.js'
import compensationDataset from './compensation.js'
import separationDataset   from './separation.js'

export default async function datasetsRoutes(fastify: FastifyInstance) {
  await fastify.register(headcountDataset,    { prefix: '/headcount'    })
  await fastify.register(attendanceDataset,   { prefix: '/attendance'   })
  await fastify.register(statutoryDataset,    { prefix: '/statutory'    })
  await fastify.register(payrollCostDataset,  { prefix: '/payroll-cost' })
  await fastify.register(employeesDataset,    { prefix: '/employees'    })
  await fastify.register(leaveDataset,        { prefix: '/leave'        })
  await fastify.register(compensationDataset, { prefix: '/compensation' })
  await fastify.register(separationDataset,   { prefix: '/separation'   })
}
