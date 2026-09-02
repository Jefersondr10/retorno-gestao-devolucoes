CREATE TABLE `organization_quota_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`return_id` text NOT NULL,
	`return_count` integer DEFAULT 1 NOT NULL,
	`media_bytes` integer DEFAULT 0 NOT NULL,
	`object_keys_json` text DEFAULT '[]' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quota_reservation_return_count_check" CHECK("organization_quota_reservations"."return_count" > 0),
	CONSTRAINT "quota_reservation_media_bytes_check" CHECK("organization_quota_reservations"."media_bytes" >= 0),
	CONSTRAINT "quota_reservation_object_keys_json_check" CHECK(json_valid("organization_quota_reservations"."object_keys_json") = 1 AND json_type("organization_quota_reservations"."object_keys_json") = 'array')
);
--> statement-breakpoint
CREATE INDEX `idx_quota_reservations_org_expires` ON `organization_quota_reservations` (`organization_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quota_reservations_return_id` ON `organization_quota_reservations` (`return_id`);
--> statement-breakpoint
CREATE TRIGGER `quota_reservation_valid_expiry`
BEFORE INSERT ON `organization_quota_reservations`
WHEN NEW.`expires_at` <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  OR NEW.`expires_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour')
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.`object_keys_json`)
    WHERE type <> 'text' OR value = ''
  )
  OR json_array_length(NEW.`object_keys_json`) <>
    (SELECT COUNT(DISTINCT value) FROM json_each(NEW.`object_keys_json`))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_QUOTA_RESERVATION');
END;
--> statement-breakpoint
CREATE TRIGGER `quota_reservation_return_limit`
BEFORE INSERT ON `organization_quota_reservations`
WHEN (
  (SELECT COUNT(*) FROM `returns` WHERE `organization_id` = NEW.`organization_id`)
  + (SELECT COALESCE(SUM(`return_count`), 0) FROM `organization_quota_reservations`
     WHERE `organization_id` = NEW.`organization_id`)
  + NEW.`return_count`
) > 25000
BEGIN
  SELECT RAISE(ABORT, 'ORG_RETURN_QUOTA_EXCEEDED');
END;
--> statement-breakpoint
CREATE TRIGGER `quota_reservation_storage_limit`
BEFORE INSERT ON `organization_quota_reservations`
WHEN (
  (SELECT COALESCE(SUM(photo.`size`), 0) FROM `return_photos` photo
     INNER JOIN `returns` item_return ON item_return.`id` = photo.`return_id`
     WHERE item_return.`organization_id` = NEW.`organization_id`)
  + (SELECT COALESCE(SUM(video.`size`), 0) FROM `return_videos` video
     INNER JOIN `returns` item_return ON item_return.`id` = video.`return_id`
     WHERE item_return.`organization_id` = NEW.`organization_id`)
  + (SELECT COALESCE(SUM(`media_bytes`), 0) FROM `organization_quota_reservations`
     WHERE `organization_id` = NEW.`organization_id`)
  + (SELECT COALESCE(SUM(
      CASE WHEN json_valid(deletion_event.`details`) THEN
        CASE WHEN json_type(deletion_event.`details`, '$.bytes') IN ('integer', 'real')
          THEN MAX(CAST(json_extract(deletion_event.`details`, '$.bytes') AS INTEGER), 0)
          WHEN json_type(deletion_event.`details`, '$.objectKeys') = 'array'
            AND json_array_length(deletion_event.`details`, '$.objectKeys') > 0 THEN 1073741824
          ELSE 0 END
        ELSE 0 END
      ), 0)
     FROM `audit_events` deletion_event
     WHERE deletion_event.`organization_id` = NEW.`organization_id`
       AND deletion_event.`action` IN ('VIDEOS_DELETION_PENDING', 'STORAGE_DELETION_PENDING'))
  + NEW.`media_bytes`
) > 1073741824
BEGIN
  SELECT RAISE(ABORT, 'ORG_STORAGE_QUOTA_EXCEEDED');
END;
--> statement-breakpoint
CREATE TRIGGER `quota_reservation_immutable`
BEFORE UPDATE ON `organization_quota_reservations`
BEGIN
  SELECT RAISE(ABORT, 'QUOTA_RESERVATION_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `quota_reservation_validate_release`
BEFORE DELETE ON `organization_quota_reservations`
WHEN EXISTS (
  SELECT 1 FROM `returns`
  WHERE `id` = OLD.`return_id` AND `organization_id` = OLD.`organization_id`
)
AND (
  (SELECT COALESCE(SUM(`size`), 0) FROM `return_photos` WHERE `return_id` = OLD.`return_id`)
    + (SELECT COALESCE(SUM(`size`), 0) FROM `return_videos` WHERE `return_id` = OLD.`return_id`) <> OLD.`media_bytes`
  OR (SELECT COUNT(*) FROM `return_photos` WHERE `return_id` = OLD.`return_id`)
    + (SELECT COUNT(*) FROM `return_videos` WHERE `return_id` = OLD.`return_id`) <> json_array_length(OLD.`object_keys_json`)
  OR EXISTS (
    SELECT 1 FROM (
      SELECT `object_key` FROM `return_photos` WHERE `return_id` = OLD.`return_id`
      UNION ALL
      SELECT `object_key` FROM `return_videos` WHERE `return_id` = OLD.`return_id`
    ) media
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(OLD.`object_keys_json`) WHERE value = media.`object_key`
    )
  )
  OR EXISTS (
    SELECT 1 FROM json_each(OLD.`object_keys_json`) manifest
    WHERE typeof(manifest.value) <> 'text'
      OR NOT EXISTS (
        SELECT 1 FROM `return_photos`
        WHERE `return_id` = OLD.`return_id` AND `object_key` = manifest.value
        UNION ALL
        SELECT 1 FROM `return_videos`
        WHERE `return_id` = OLD.`return_id` AND `object_key` = manifest.value
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'QUOTA_RESERVATION_MISMATCH');
END;
