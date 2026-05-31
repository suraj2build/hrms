-- Force PostgREST schema cache reload after migration batch 169-174.
-- PostgREST automatically reloads on any DDL change.
COMMENT ON TABLE leave_requests IS 'Employee leave requests with full duration-engine and governance support.';
