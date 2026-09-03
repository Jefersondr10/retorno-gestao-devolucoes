CREATE TABLE `organization_membership_permissions` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`permission` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`, `permission`),
	FOREIGN KEY (`organization_id`,`user_id`) REFERENCES `organization_memberships`(`organization_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "membership_permission_value_check" CHECK("organization_membership_permissions"."permission" IN ('returns.view', 'returns.create', 'returns.edit', 'returns.finalize', 'returns.delete', 'settings.manage', 'retention.manage', 'team.manage'))
);

INSERT OR IGNORE INTO `organization_membership_permissions` (`organization_id`, `user_id`, `permission`, `created_at`)
SELECT `organization_id`, `user_id`, 'returns.view', `updated_at`
FROM `organization_memberships`
WHERE `role` = 'OPERATOR';

INSERT OR IGNORE INTO `organization_membership_permissions` (`organization_id`, `user_id`, `permission`, `created_at`)
SELECT `organization_id`, `user_id`, 'returns.create', `updated_at`
FROM `organization_memberships`
WHERE `role` = 'OPERATOR';

INSERT OR IGNORE INTO `organization_membership_permissions` (`organization_id`, `user_id`, `permission`, `created_at`)
SELECT `organization_id`, `user_id`, 'returns.edit', `updated_at`
FROM `organization_memberships`
WHERE `role` = 'OPERATOR';

INSERT OR IGNORE INTO `organization_membership_permissions` (`organization_id`, `user_id`, `permission`, `created_at`)
SELECT `organization_id`, `user_id`, 'returns.finalize', `updated_at`
FROM `organization_memberships`
WHERE `role` = 'OPERATOR';
