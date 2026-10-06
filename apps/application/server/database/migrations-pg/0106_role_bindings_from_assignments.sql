-- Each project assignment of a reporter or a user becomes a role binding on the same scope (a null
-- project is all projects): Maintainer for a reporter, Viewer for a user, the project roles granting
-- exactly what those accounts could do. An administrator's assignments carry no right and are dropped.
INSERT INTO "role_bindings" ("user_id", "project_id", "role", "created_by", "created_at")
SELECT "pa"."user_id", "pa"."project_id",
  CASE "u"."role" WHEN 'reporter' THEN 'maintainer' ELSE 'viewer' END,
  "pa"."created_by", "pa"."created_at"
FROM "project_assignments" "pa"
INNER JOIN "users" "u" ON "u"."id" = "pa"."user_id"
WHERE "u"."role" IN ('reporter', 'user')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The one-time all-projects grant of the upgrade that introduced project access, when a database
-- still owes it: its `project_assignments_backfilled` setting is not settled to true (absent, 'owed'
-- or 'granting') and no assignment exists yet.
INSERT INTO "role_bindings" ("user_id", "role", "created_at")
SELECT "id", CASE "role" WHEN 'reporter' THEN 'maintainer' ELSE 'viewer' END, now() AT TIME ZONE 'UTC'
FROM "users"
WHERE "role" IN ('reporter', 'user')
  AND NOT EXISTS (SELECT 1 FROM "project_assignments")
  AND NOT EXISTS (SELECT 1 FROM "app_settings" WHERE "key" = 'project_assignments_backfilled' AND "value" = 'true'::jsonb)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM "app_settings" WHERE "key" = 'project_assignments_backfilled';
--> statement-breakpoint
-- Everyone but an administrator is a member of the instance; their project roles are in role_bindings.
UPDATE "users" SET "role" = 'member' WHERE "role" IN ('reporter', 'user');
