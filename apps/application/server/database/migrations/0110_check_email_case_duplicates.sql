-- Custom SQL migration file, put your code below! --

-- Stops the upgrade while two users have the same email address written with
-- different letter case (`Bob@corp.com`, `bob@corp.com`): the next migration
-- makes `idx_users_email` unique ignoring case, and accounts are never merged
-- automatically. SQLite raises a custom error only from a trigger, so one fires
-- on the first such address copied into a temporary table.
CREATE TEMP TABLE `__piwi_email_case_duplicates` (`email` text);
--> statement-breakpoint
CREATE TEMP TRIGGER `__piwi_email_case_duplicates_refuse` BEFORE INSERT ON `__piwi_email_case_duplicates`
BEGIN
	SELECT RAISE(ABORT, 'Several users have the same email address written with different letter case, and email addresses must be unique ignoring case. Piwi does not merge accounts: list them with SELECT id, username, email FROM users WHERE lower(email) IN (SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1); then give all but one user of each address another address or none (UPDATE users SET email = NULL, email_verified = 0 WHERE id = <id>), and restart.');
END;
--> statement-breakpoint
INSERT INTO `__piwi_email_case_duplicates`
SELECT lower(`email`) FROM `users` WHERE `email` IS NOT NULL GROUP BY lower(`email`) HAVING count(*) > 1;
--> statement-breakpoint
DROP TABLE `__piwi_email_case_duplicates`;
