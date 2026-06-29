-- Sprint 5: Survey Management
-- surveys, survey_questions, survey_assignments, survey_responses

create table if not exists surveys (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  title       text not null,
  description text,
  status      text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  due_date    date,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists survey_questions (
  id            uuid primary key default gen_random_uuid(),
  survey_id     uuid not null references surveys(id) on delete cascade,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  order_idx     integer not null default 0,
  question_text text not null,
  question_type text not null default 'text'
                check (question_type in ('text', 'rating', 'single', 'multi')),
  options       jsonb,
  required      boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists survey_assignments (
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid not null references surveys(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (survey_id, employee_id)
);

create table if not exists survey_responses (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references survey_assignments(id) on delete cascade,
  question_id   uuid not null references survey_questions(id) on delete cascade,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  response      jsonb not null,
  created_at    timestamptz not null default now(),
  unique (assignment_id, question_id)
);

create index if not exists idx_surveys_tenant_status        on surveys(tenant_id, status);
create index if not exists idx_survey_questions_survey      on survey_questions(survey_id, order_idx);
create index if not exists idx_survey_assignments_employee  on survey_assignments(employee_id, tenant_id);
create index if not exists idx_survey_assignments_survey    on survey_assignments(survey_id);
create index if not exists idx_survey_responses_assignment  on survey_responses(assignment_id);

alter table surveys            enable row level security;
alter table survey_questions   enable row level security;
alter table survey_assignments enable row level security;
alter table survey_responses   enable row level security;

drop policy if exists "tenant_isolation_surveys" on surveys;
create policy "tenant_isolation_surveys"
  on surveys using (tenant_id = get_user_tenant_id());

drop policy if exists "tenant_isolation_survey_questions" on survey_questions;
create policy "tenant_isolation_survey_questions"
  on survey_questions using (tenant_id = get_user_tenant_id());

drop policy if exists "tenant_isolation_survey_assignments" on survey_assignments;
create policy "tenant_isolation_survey_assignments"
  on survey_assignments using (tenant_id = get_user_tenant_id());

drop policy if exists "tenant_isolation_survey_responses" on survey_responses;
create policy "tenant_isolation_survey_responses"
  on survey_responses using (tenant_id = get_user_tenant_id());
