-- Custom SQL migration file, put your code below! --

-- Stops the upgrade while two users have the same email address written with
-- different letter case (`Bob@corp.com`, `bob@corp.com`): the next migration
-- makes `idx_users_email` unique ignoring case, and accounts are never merged
-- automatically. The error lists the ids of the users of each such address.
DO $$
DECLARE
	duplicates text;
BEGIN
	SELECT string_agg(ids, '; ' ORDER BY first_id) INTO duplicates FROM (
		SELECT min("id") AS first_id, string_agg("id"::text, ', ' ORDER BY "id") AS ids
		FROM "users"
		WHERE "email" IS NOT NULL
		GROUP BY lower("email")
		HAVING count(*) > 1
	) AS shared;
	IF duplicates IS NOT NULL THEN
		RAISE EXCEPTION 'Several users have the same email address written with different letter case (user ids by address: %), and email addresses must be unique ignoring case. Piwi does not merge accounts: give all but one user of each address another address or none (UPDATE users SET email = NULL, email_verified = 0 WHERE id = <id>), and restart.', duplicates;
	END IF;
END $$;
