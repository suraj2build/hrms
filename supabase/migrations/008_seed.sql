-- Demo seed data (optional — for local development)
-- Run after migrations and after creating a test user via Supabase Auth

-- Example: uncomment and replace UUIDs after setting up a real user
/*
INSERT INTO tenants (id, name, slug, industry, size_range) VALUES
  ('11111111-1111-1111-1111-111111111111', 'CityKart Retail Pvt Ltd', 'citykart', 'Retail', '2000+');

INSERT INTO departments (tenant_id, name, code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Human Resources', 'HR'),
  ('11111111-1111-1111-1111-111111111111', 'Technology', 'TECH'),
  ('11111111-1111-1111-1111-111111111111', 'Operations', 'OPS'),
  ('11111111-1111-1111-1111-111111111111', 'Finance', 'FIN'),
  ('11111111-1111-1111-1111-111111111111', 'Retail Floor', 'FLOOR');

INSERT INTO designations (tenant_id, name, level) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Store Manager', 6),
  ('11111111-1111-1111-1111-111111111111', 'Senior Executive', 4),
  ('11111111-1111-1111-1111-111111111111', 'Executive', 3),
  ('11111111-1111-1111-1111-111111111111', 'Team Lead', 5),
  ('11111111-1111-1111-1111-111111111111', 'Floor Staff', 2);

INSERT INTO grades (tenant_id, name, code, min_salary, max_salary) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Band A', 'A', 200000, 400000),
  ('11111111-1111-1111-1111-111111111111', 'Band B', 'B', 400000, 700000),
  ('11111111-1111-1111-1111-111111111111', 'Band C', 'C', 700000, 1200000),
  ('11111111-1111-1111-1111-111111111111', 'Band D', 'D', 1200000, 2000000);
*/
