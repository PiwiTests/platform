-- Custom SQL migration file, put your code below! --

-- One address belongs to one account, ignoring letter case, as the next
-- migration's `idx_users_email` on `lower(email)` requires. Among accounts
-- whose emails differ only in case, the address stays on the oldest account
-- that verified it, else on the oldest account; the others lose the address
-- and its verified flag.
UPDATE users
SET email = NULL, email_verified = 0
WHERE email IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM users AS keeper
		WHERE lower(keeper.email) = lower(users.email)
			AND keeper.id <> users.id
			AND (
				keeper.email_verified > users.email_verified
				OR (keeper.email_verified = users.email_verified AND keeper.id < users.id)
			)
	);
