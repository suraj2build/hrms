-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #9  (run AFTER seed-demo.sql)
--  Populates the ESS 2.0 RECOGNITION + COMMUNITY pillars, which the new mobile
--  (and desktop) screens read but the core seed leaves empty:
--    · recognition          (peer kudos — Priya/e01 both gives & receives so the
--                            "me" view + leaderboard populate)
--    · feed_posts           (pinned HR announcements + employee updates +
--                            birthday/anniversary/new-joiner/milestone posts)
--    · feed_reactions        (like/celebrate/appreciate/support — incl. Priya's,
--                            so my_reaction shows on the demo login)
--    · feed_comments        (threaded replies)
--
--  Badge catalogue is already seeded by migration 306 (recognition_badges);
--  badge points used here mirror that catalogue exactly.
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
--
--  Fixed IDs from seed-demo.sql:
--    tenant   = d0000000-0000-0000-0000-000000000001
--    demo login (profile d0…a1) resolves to employee e01 = Priya Sharma
--    emp NN   = e0000000-0000-0000-0000-0000000000NN   (01..0c)
--      01 Priya Sharma   02 Rahul Verma    03 Deepak Chawla  04 Sneha Sen
--      05 Arjun Rampal   06 Nandini Gupta  07 Ayesha Ahmed   08 Vikram Singh
--      09 Kavya Nair     0a Rohan Mehta    0b Ananya Iyer    0c Karan Patel
--  Badge points: ownership_champion 15, customer_hero 15, team_player 10,
--                innovator 15, problem_solver 10, culture_ambassador 10
-- ============================================================================

begin;

-- ── RESET (child → parent FK order) ─────────────────────────────────────────
delete from feed_comments  where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from feed_reactions where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from feed_posts     where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from recognition    where tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ── RECOGNITION (peer kudos) ────────────────────────────────────────────────
insert into recognition (tenant_id, from_employee, to_employee, badge_code, message, points, visibility, created_at) values
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000003','problem_solver',     'Cracked the month-end payroll reconciliation bug under real pressure. Lifesaver!',          10,'public', now() - interval '18 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000001','culture_ambassador', 'Priya sets the tone for the whole team — always lifts everyone up.',                        10,'public', now() - interval '16 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','innovator',          'Kavya''s self-service ticketing idea cut our helpdesk backlog in half. Brilliant.',          15,'public', now() - interval '14 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000002','team_player',        'Rahul jumped in on the release weekend without being asked. True team player.',             10,'public', now() - interval '12 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000001','ownership_champion', 'Took full ownership of the audit and saw it through end to end. Thank you Priya!',           15,'public', now() - interval '11 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','e0000000-0000-0000-0000-00000000000b','customer_hero',      'Ananya stayed late to unblock a key customer go-live. Above and beyond.',                    15,'public', now() - interval '10 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','team_player',        'Ayesha quietly keeps the onboarding running smoothly for everyone. Appreciate you!',         10,'public', now() - interval '9 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','e0000000-0000-0000-0000-000000000005','innovator',          'Arjun''s dashboard prototype wowed the demo-day crowd. Great new thinking.',                 15,'public', now() - interval '8 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','e0000000-0000-0000-0000-000000000001','team_player',        'Always makes time to mentor the new joiners. Thanks for having our backs, Priya.',           10,'public', now() - interval '7 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000c','e0000000-0000-0000-0000-000000000004','problem_solver',     'Sneha untangled the leave-accrual edge case nobody else could. Sharp work.',                 10,'public', now() - interval '6 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000009','customer_hero',      'Kavya turned an unhappy customer into a reference call. Incredible save.',                   15,'public', now() - interval '5 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','culture_ambassador', 'Rohan brought such positive energy in his first month. Glad you''re here!',                  10,'public', now() - interval '4 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','e0000000-0000-0000-0000-000000000001','innovator',          'Priya''s recognition-rewards rollout is already changing how the team connects. Love it.',   15,'public', now() - interval '3 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-000000000003','ownership_champion', 'Deepak owned the data migration from start to finish. Rock solid.',                          15,'public', now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000009','team_player',        'Kavya covered the support desk so the rest of us could ship. Legend.',                       10,'public', now() - interval '1 days');

-- ── COMMUNITY: feed_posts (deterministic ids so reactions/comments can FK) ──
insert into feed_posts (id, tenant_id, author_employee, type, title, body, pinned, status, created_at) values
  ('f0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','announcement','Diwali holiday schedule', 'The office will be closed Mon–Tue for Diwali. Payroll for the month will still process on schedule — wishing everyone a bright and safe festival! 🪔', true,  'active', now() - interval '1 days'),
  ('f0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','announcement','New wellness benefit is live', 'Starting this month every employee gets an annual wellness allowance. Submit claims under Reimbursements → Wellness. Details in the handbook.', true, 'active', now() - interval '5 days'),
  ('f0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','update', null, 'Shipped the new one-click payroll export today 🎉 Finance can now pull a full run in seconds instead of stitching spreadsheets. Feedback welcome!', false, 'active', now() - interval '2 days'),
  ('f0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','milestone', null, 'Just crossed 100 resolved customer tickets this quarter 🙌 Thanks to everyone who jumped in on the tough ones.', false, 'active', now() - interval '3 days'),
  ('f0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','new_joiner','Welcome Rohan Mehta!', 'Please join us in welcoming Rohan to the team this week. He''s joining as part of the operations group — say hi when you see him around! 👋', false, 'active', now() - interval '6 days'),
  ('f0000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','birthday', null, 'Happy birthday Sneha Sen! 🎂 Wishing you a fantastic year ahead.', false, 'active', now() - interval '4 days'),
  ('f0000000-0000-0000-0000-000000000007','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','anniversary', null, 'Karan Patel celebrates 6 years with us today! 🎉 Thank you for everything you''ve built here.', false, 'active', now() - interval '7 days'),
  ('f0000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','update', null, 'Demo day was a blast — thanks to everyone who came to see the new analytics dashboard. Slides are in the shared drive.', false, 'active', now() - interval '8 days'),
  ('f0000000-0000-0000-0000-000000000009','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','recognition', null, 'Huge thanks to the QA squad for an absolutely clean release this sprint. Zero rollbacks. 👏', false, 'active', now() - interval '9 days');

-- ── COMMUNITY: feed_reactions (one per person per post; incl. Priya/e01 so
--    my_reaction renders on the demo login) ──────────────────────────────────
insert into feed_reactions (tenant_id, post_id, employee_id, reaction, created_at) values
  -- f01 Diwali announcement
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','like',       now() - interval '23 hours'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','celebrate',  now() - interval '22 hours'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','like',       now() - interval '21 hours'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','appreciate', now() - interval '20 hours'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','like',       now() - interval '19 hours'),
  -- f02 wellness benefit
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002','celebrate',  now() - interval '4 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000006','like',       now() - interval '4 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000007','support',    now() - interval '4 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-00000000000b','like',       now() - interval '4 days'),
  -- f03 payroll export (Priya reacts)
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000001','celebrate',  now() - interval '1 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000005','like',       now() - interval '1 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000009','appreciate', now() - interval '1 days'),
  -- f04 100 tickets milestone (Priya reacts)
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000001','celebrate',  now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000002','like',       now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000003','like',       now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000008','support',    now() - interval '2 days'),
  -- f05 welcome Rohan
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000004','like',       now() - interval '5 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000007','like',       now() - interval '5 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-00000000000a','celebrate',  now() - interval '5 days'),
  -- f06 birthday (Priya reacts)
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000006','e0000000-0000-0000-0000-000000000001','like',       now() - interval '3 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000006','e0000000-0000-0000-0000-000000000002','celebrate',  now() - interval '3 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000006','e0000000-0000-0000-0000-000000000003','like',       now() - interval '3 days'),
  -- f08 demo day (Priya reacts)
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000008','e0000000-0000-0000-0000-000000000001','appreciate', now() - interval '7 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000008','e0000000-0000-0000-0000-000000000002','like',       now() - interval '7 days'),
  -- f09 QA squad
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000009','e0000000-0000-0000-0000-000000000004','like',       now() - interval '8 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000009','e0000000-0000-0000-0000-000000000005','like',       now() - interval '8 days');

-- ── COMMUNITY: feed_comments ────────────────────────────────────────────────
insert into feed_comments (tenant_id, post_id, employee_id, body, created_at) values
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','Thanks for the early heads up — booking my travel now!', now() - interval '18 hours'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','Finally a long weekend 🙌', now() - interval '16 hours'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000001','Great work Rahul 👏 this has been on the wishlist for ages.', now() - interval '1 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000009','This is going to save the support team hours every week.', now() - interval '20 hours'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000001','Incredible milestone Kavya — so proud of the team!', now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000002','Welcome aboard Rohan! 🎉', now() - interval '5 days'),
  ('d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000007','Glad to have you with us!', now() - interval '5 days');

commit;
