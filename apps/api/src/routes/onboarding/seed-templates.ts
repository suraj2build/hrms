/**
 * POST /onboarding/seed-default-templates
 *
 * Seeds default checklist templates for the tenant if none exist.
 * Safe to call multiple times — skips if templates already exist.
 * HR Admin only.
 */
import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

const DEFAULT_TEMPLATES = [
  {
    name: 'Standard Employee Onboarding',
    description: 'Default checklist for all new joiners — IT setup, documentation, induction, and compliance.',
    is_default: true,
    items: [
      { title: 'Collect signed offer letter',           category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Collect educational certificates',      category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Collect Aadhaar & PAN copies',          category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Collect bank account details',          category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 2,  is_mandatory: true  },
      { title: 'Collect passport photo',                category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 1,  is_mandatory: false },
      { title: 'Create company email account',          category: 'it_setup',            assigned_to_role: 'it',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Provision laptop / workstation',        category: 'it_setup',            assigned_to_role: 'it',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Grant system access & software tools',  category: 'access_provisioning', assigned_to_role: 'it',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Add to payroll system',                 category: 'compliance',          assigned_to_role: 'hr',       due_day_offset: 3,  is_mandatory: true  },
      { title: 'Register for EPF / ESI',                category: 'compliance',          assigned_to_role: 'hr',       due_day_offset: 7,  is_mandatory: true  },
      { title: 'Introduce to team & assign buddy',      category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 0,  is_mandatory: true  },
      { title: 'Complete HR policy induction',          category: 'induction',           assigned_to_role: 'hr',       due_day_offset: 3,  is_mandatory: true  },
      { title: 'Complete role-specific induction',      category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 5,  is_mandatory: true  },
      { title: 'Set 30-60-90 day goals',                category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 7,  is_mandatory: false },
      { title: 'Issue ID card & access card',           category: 'access_provisioning', assigned_to_role: 'admin',    due_day_offset: 2,  is_mandatory: true  },
      { title: 'Add to attendance system (biometric)',  category: 'it_setup',            assigned_to_role: 'admin',    due_day_offset: 1,  is_mandatory: true  },
    ],
  },
  {
    name: 'IT Staff Onboarding',
    description: 'Extended checklist for engineering and technology roles.',
    is_default: false,
    items: [
      { title: 'Collect signed offer letter',           category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Collect Aadhaar & PAN copies',          category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Collect bank account details',          category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 2,  is_mandatory: true  },
      { title: 'Create company email account',          category: 'it_setup',            assigned_to_role: 'it',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Provision MacBook / laptop',            category: 'it_setup',            assigned_to_role: 'it',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Grant GitHub / Jira / Confluence access',category: 'access_provisioning',assigned_to_role: 'it',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Grant VPN & server access',             category: 'access_provisioning', assigned_to_role: 'it',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Add to Slack workspace',                category: 'access_provisioning', assigned_to_role: 'it',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Code repository access & onboarding',  category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 2,  is_mandatory: true  },
      { title: 'Architecture & tech stack walkthrough', category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 3,  is_mandatory: true  },
      { title: 'Register for EPF / ESI',                category: 'compliance',          assigned_to_role: 'hr',       due_day_offset: 7,  is_mandatory: true  },
      { title: 'Set 30-60-90 day engineering goals',    category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 7,  is_mandatory: false },
    ],
  },
  {
    name: 'Field / Operations Staff Onboarding',
    description: 'Checklist for field, sales, or operations staff joining.',
    is_default: false,
    items: [
      { title: 'Collect signed appointment letter',     category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 0,  is_mandatory: true  },
      { title: 'Collect Aadhaar & PAN copies',          category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Collect bank account details',          category: 'document_collection', assigned_to_role: 'hr',       due_day_offset: 2,  is_mandatory: true  },
      { title: 'Issue company mobile / SIM card',       category: 'it_setup',            assigned_to_role: 'admin',    due_day_offset: 1,  is_mandatory: false },
      { title: 'Install attendance app on mobile',      category: 'it_setup',            assigned_to_role: 'it',       due_day_offset: 1,  is_mandatory: true  },
      { title: 'Assign territory / route / beat plan',  category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 1,  is_mandatory: true  },
      { title: 'Issue uniform / field kit',             category: 'access_provisioning', assigned_to_role: 'admin',    due_day_offset: 1,  is_mandatory: false },
      { title: 'Field induction & safety briefing',     category: 'induction',           assigned_to_role: 'manager',  due_day_offset: 2,  is_mandatory: true  },
      { title: 'Register for ESI (if applicable)',      category: 'compliance',          assigned_to_role: 'hr',       due_day_offset: 7,  is_mandatory: true  },
      { title: 'Add to biometric / geo-fence attendance',category: 'it_setup',           assigned_to_role: 'admin',    due_day_offset: 1,  is_mandatory: true  },
    ],
  },
]

export default async function seedOnboardingTemplatesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.post('/onboarding/seed-default-templates', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }

    // Check if templates already exist
    const { count } = await fastify.supabase
      .from('onboarding_checklist_templates')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', req.tenantId)

    if ((count ?? 0) > 0) {
      return reply.send({ message: 'Templates already exist — skipped', count })
    }

    const created: string[] = []

    for (const tpl of DEFAULT_TEMPLATES) {
      const { data: template, error: tplErr } = await fastify.supabase
        .from('onboarding_checklist_templates')
        .insert({
          tenant_id:   req.tenantId,
          name:        tpl.name,
          description: tpl.description,
          is_default:  tpl.is_default,
          is_active:   true,
        })
        .select('id')
        .single()

      if (tplErr || !template) continue

      const items = tpl.items.map((item, idx) => ({
        tenant_id:        req.tenantId,
        template_id:      template.id,
        title:            item.title,
        category:         item.category,
        assigned_to_role: item.assigned_to_role,
        due_day_offset:   item.due_day_offset,
        is_mandatory:     item.is_mandatory,
        sort_order:       idx,
      }))

      const { error: itemsErr } = await fastify.supabase.from('onboarding_checklist_items').insert(items)
      if (itemsErr) {
        req.log.warn({ err: itemsErr, template: tpl.name }, 'seed-default-templates: checklist item insert failed — template left with no items')
        continue
      }
      created.push(tpl.name)
    }

    return reply.send({
      message: `Seeded ${created.length} default templates`,
      templates: created,
    })
  })
}
