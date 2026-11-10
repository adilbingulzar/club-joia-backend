-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NULL,
    `role` ENUM('MEMBER', 'CONCIERGE', 'CHECK_IN_STAFF', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'MEMBER',
    `status` ENUM('PENDING_ACTIVATION', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'PENDING_ACTIVATION',
    `email_verified_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NULL,
    `mfa_enabled` BOOLEAN NOT NULL DEFAULT false,
    `mfa_secret_encrypted` TEXT NULL,
    `mfa_enrolled_at` DATETIME(3) NULL,
    `whatsapp_number` VARCHAR(191) NULL,
    `alert_by_email` BOOLEAN NOT NULL DEFAULT true,
    `alert_by_whatsapp` BOOLEAN NOT NULL DEFAULT false,
    `concierge_categories` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_identities` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `provider_account_id` VARCHAR(191) NOT NULL,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `auth_identities_user_id_idx`(`user_id`),
    UNIQUE INDEX `auth_identities_provider_provider_account_id_key`(`provider`, `provider_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `mfa_verified` BOOLEAN NOT NULL DEFAULT false,
    `ip_address` VARCHAR(191) NULL,
    `user_agent` VARCHAR(500) NULL,

    UNIQUE INDEX `sessions_token_hash_key`(`token_hash`),
    INDEX `sessions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `type` ENUM('ACTIVATION', 'PASSWORD_RESET', 'MAGIC_LINK', 'EMAIL_CHANGE') NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_tokens_user_id_type_idx`(`user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rate_limit_buckets` (
    `key` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `window_start` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `members` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `membership_number` VARCHAR(191) NOT NULL,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NULL,
    `mobile` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `nationality` VARCHAR(191) NULL,
    `profile_photo_key` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `job_title` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `bio` TEXT NULL,
    `dietary_requirements` VARCHAR(500) NULL,
    `allergies` VARCHAR(500) NULL,
    `emergency_contact_name` VARCHAR(191) NULL,
    `emergency_contact_phone` VARCHAR(191) NULL,
    `shirt_size` VARCHAR(191) NULL,
    `preferences` JSON NOT NULL,
    `privacy_settings` JSON NOT NULL,
    `networking_profile_enabled` BOOLEAN NOT NULL DEFAULT false,
    `networking_interests` JSON NOT NULL,
    `looking_to_meet` JSON NOT NULL,
    `linkedin_url` VARCHAR(500) NULL,
    `investment_interests` JSON NOT NULL,
    `social_links` JSON NOT NULL,
    `public_profile_fields` JSON NOT NULL,
    `member_since` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletion_requested_at` DATETIME(3) NULL,
    `anonymized_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `members_user_id_key`(`user_id`),
    UNIQUE INDEX `members_membership_number_key`(`membership_number`),
    INDEX `members_last_name_first_name_idx`(`last_name`, `first_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consent_records` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `type` ENUM('TERMS', 'PRIVACY_POLICY', 'MARKETING', 'PUSH_NOTIFICATIONS', 'DATA_PROCESSING') NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `ip_address` VARCHAR(191) NULL,
    `user_agent` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `consent_records_user_id_type_idx`(`user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chapters` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chapters_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_tiers` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `display_name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(191) NOT NULL,
    `card_theme` VARCHAR(191) NOT NULL DEFAULT 'ruby',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `membership_tiers_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memberships` (
    `id` VARCHAR(191) NOT NULL,
    `member_id` VARCHAR(191) NOT NULL,
    `tier_id` VARCHAR(191) NOT NULL,
    `membership_number` VARCHAR(191) NOT NULL,
    `kind` ENUM('EVENT', 'ANNUAL') NOT NULL DEFAULT 'EVENT',
    `status` ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'INVITED',
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `issue_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `home_chapter_id` VARCHAR(191) NULL,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `memberships_membership_number_key`(`membership_number`),
    INDEX `memberships_member_id_status_idx`(`member_id`, `status`),
    INDEX `memberships_tier_id_status_idx`(`tier_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entitlements` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `value_type` ENUM('BOOLEAN', 'INTEGER', 'TEXT') NOT NULL DEFAULT 'BOOLEAN',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `entitlements_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tier_entitlements` (
    `tier_id` VARCHAR(191) NOT NULL,
    `entitlement_id` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `metadata` JSON NOT NULL,

    PRIMARY KEY (`tier_id`, `entitlement_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_entitlements` (
    `id` VARCHAR(191) NOT NULL,
    `member_id` VARCHAR(191) NOT NULL,
    `entitlement_id` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `reason` TEXT NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `member_entitlements_member_id_entitlement_id_key`(`member_id`, `entitlement_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `events` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `chapter_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `city` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `venue` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'LIVE', 'COMPLETED', 'ARCHIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `hero_image` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `events_slug_key`(`slug`),
    INDEX `events_status_start_date_idx`(`status`, `start_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_zones` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `required_entitlement_code` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `access_zones_event_id_code_key`(`event_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_program_items` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `start_time` VARCHAR(191) NOT NULL,
    `end_time` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `location` VARCHAR(191) NULL,
    `category` ENUM('ARRIVAL', 'HOSPITALITY', 'RACING', 'FOOD', 'ENTERTAINMENT', 'NETWORKING', 'CONCIERGE', 'AFTER_PARTY', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `icon` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `visibility` ENUM('DRAFT', 'MEMBERS', 'RESTRICTED') NOT NULL DEFAULT 'DRAFT',
    `required_entitlement_code` VARCHAR(191) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `capacity` INTEGER NULL,
    `is_sample` BOOLEAN NOT NULL DEFAULT false,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `event_program_items_event_id_date_sort_order_idx`(`event_id`, `date`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_program_favorites` (
    `member_id` VARCHAR(191) NOT NULL,
    `program_item_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`member_id`, `program_item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_types` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `valid_from` DATETIME(3) NOT NULL,
    `valid_until` DATETIME(3) NOT NULL,
    `entry_policy` ENUM('SINGLE_ENTRY', 'DAILY_ENTRY', 'MULTI_ENTRY') NOT NULL DEFAULT 'MULTI_ENTRY',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ticket_types_event_id_code_key`(`event_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_type_zones` (
    `ticket_type_id` VARCHAR(191) NOT NULL,
    `zone_id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`ticket_type_id`, `zone_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickets` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `ticket_type_id` VARCHAR(191) NOT NULL,
    `member_id` VARCHAR(191) NOT NULL,
    `ticket_number` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'USED', 'REVOKED', 'EXPIRED', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `valid_from` DATETIME(3) NOT NULL,
    `valid_until` DATETIME(3) NOT NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `issued_by_id` VARCHAR(191) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_id` VARCHAR(191) NULL,
    `revoke_reason` TEXT NULL,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tickets_ticket_number_key`(`ticket_number`),
    INDEX `tickets_member_id_event_id_idx`(`member_id`, `event_id`),
    INDEX `tickets_event_id_status_idx`(`event_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_credentials` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `credential_ref` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` TEXT NULL,

    UNIQUE INDEX `ticket_credentials_credential_ref_key`(`credential_ref`),
    UNIQUE INDEX `ticket_credentials_ticket_id_version_key`(`ticket_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_check_ins` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NOT NULL,
    `zone_id` VARCHAR(191) NOT NULL,
    `staff_user_id` VARCHAR(191) NOT NULL,
    `entry_key` VARCHAR(191) NOT NULL,
    `local_date` VARCHAR(191) NOT NULL,
    `checked_in_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ticket_check_ins_checked_in_at_idx`(`checked_in_at`),
    UNIQUE INDEX `ticket_check_ins_ticket_id_zone_id_entry_key_key`(`ticket_id`, `zone_id`, `entry_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_scan_logs` (
    `id` VARCHAR(191) NOT NULL,
    `ticket_id` VARCHAR(191) NULL,
    `member_id` VARCHAR(191) NULL,
    `event_id` VARCHAR(191) NULL,
    `zone_id` VARCHAR(191) NULL,
    `staff_user_id` VARCHAR(191) NOT NULL,
    `scan_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action` ENUM('VALIDATE', 'CHECK_IN', 'DENY') NOT NULL,
    `method` ENUM('QR', 'MANUAL') NOT NULL,
    `result` ENUM('VALID', 'ALREADY_USED', 'NOT_VALID_YET', 'EXPIRED', 'REVOKED', 'INVALID', 'WRONG_ACCESS_ZONE', 'SUSPENDED') NOT NULL,
    `reason` VARCHAR(191) NULL,
    `device_info` VARCHAR(300) NULL,
    `location` VARCHAR(191) NULL,
    `metadata` JSON NOT NULL,

    INDEX `ticket_scan_logs_scan_time_idx`(`scan_time`),
    INDEX `ticket_scan_logs_ticket_id_idx`(`ticket_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `concierge_requests` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `member_id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NULL,
    `category` ENUM('TRANSPORT', 'DINING', 'HOTEL', 'YACHT', 'NIGHTLIFE', 'TICKET_SUPPORT', 'SPECIAL_REQUEST', 'OTHER') NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('NEW', 'IN_PROGRESS', 'WAITING_FOR_MEMBER', 'CONFIRMED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'NEW',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `assigned_to_id` VARCHAR(191) NULL,
    `preferred_date` DATE NULL,
    `preferred_time` VARCHAR(191) NULL,
    `number_of_people` INTEGER NULL,
    `notes` TEXT NULL,
    `source` ENUM('MEMBER', 'STAFF', 'SYSTEM', 'AI_AGENT') NOT NULL DEFAULT 'MEMBER',
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `concierge_requests_reference_key`(`reference`),
    INDEX `concierge_requests_status_created_at_idx`(`status`, `created_at`),
    INDEX `concierge_requests_member_id_created_at_idx`(`member_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `concierge_request_messages` (
    `id` VARCHAR(191) NOT NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `sender_id` VARCHAR(191) NULL,
    `sender_type` ENUM('MEMBER', 'STAFF', 'SYSTEM', 'AI_AGENT') NOT NULL,
    `message` TEXT NOT NULL,
    `internal_note` BOOLEAN NOT NULL DEFAULT false,
    `attachment_key` VARCHAR(191) NULL,
    `attachment_name` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `concierge_request_messages_request_id_created_at_idx`(`request_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `type` ENUM('ANNOUNCEMENT', 'PROGRAMME', 'TICKET', 'CONCIERGE', 'TRANSPORT', 'MEMBERSHIP', 'SYSTEM') NOT NULL DEFAULT 'ANNOUNCEMENT',
    `target_type` ENUM('ALL_MEMBERS', 'TIER', 'EVENT', 'MEMBER') NOT NULL,
    `target_id` VARCHAR(191) NULL,
    `event_id` VARCHAR(191) NULL,
    `url` VARCHAR(255) NULL,
    `channels` JSON NOT NULL,
    `scheduled_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `created_by_id` VARCHAR(191) NULL,
    `metadata` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notifications_status_scheduled_at_idx`(`status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_recipients` (
    `id` VARCHAR(191) NOT NULL,
    `notification_id` VARCHAR(191) NOT NULL,
    `member_id` VARCHAR(191) NOT NULL,
    `delivery_channel` ENUM('IN_APP', 'WEB_PUSH', 'EMAIL', 'SMS', 'WHATSAPP', 'APPLE_PUSH', 'ANDROID_PUSH') NOT NULL,
    `delivery_status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(255) NULL,
    `sent_at` DATETIME(3) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_recipients_member_id_delivery_channel_read_at_idx`(`member_id`, `delivery_channel`, `read_at`),
    UNIQUE INDEX `notification_recipients_notification_id_member_id_delivery_c_key`(`notification_id`, `member_id`, `delivery_channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(768) NOT NULL,
    `p256dh` VARCHAR(191) NOT NULL,
    `auth` VARCHAR(191) NOT NULL,
    `user_agent` VARCHAR(500) NULL,
    `failure_count` INTEGER NOT NULL DEFAULT 0,
    `disabled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,

    UNIQUE INDEX `push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `push_subscriptions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stored_files` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `owner_user_id` VARCHAR(191) NULL,
    `purpose` ENUM('PROFILE_PHOTO', 'CONCIERGE_ATTACHMENT', 'EVENT_IMAGE', 'PROGRAMME_IMAGE') NOT NULL,
    `content_type` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `stored_files_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updated_by_id` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `actor_user_id` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity_type` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NULL,
    `before_data` JSON NULL,
    `after_data` JSON NULL,
    `ip_address` VARCHAR(191) NULL,
    `user_agent` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_logs_actor_user_id_idx`(`actor_user_id`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_identities` ADD CONSTRAINT `auth_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consent_records` ADD CONSTRAINT `consent_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_tier_id_fkey` FOREIGN KEY (`tier_id`) REFERENCES `membership_tiers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_home_chapter_id_fkey` FOREIGN KEY (`home_chapter_id`) REFERENCES `chapters`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tier_entitlements` ADD CONSTRAINT `tier_entitlements_tier_id_fkey` FOREIGN KEY (`tier_id`) REFERENCES `membership_tiers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tier_entitlements` ADD CONSTRAINT `tier_entitlements_entitlement_id_fkey` FOREIGN KEY (`entitlement_id`) REFERENCES `entitlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_entitlements` ADD CONSTRAINT `member_entitlements_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_entitlements` ADD CONSTRAINT `member_entitlements_entitlement_id_fkey` FOREIGN KEY (`entitlement_id`) REFERENCES `entitlements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_chapter_id_fkey` FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_zones` ADD CONSTRAINT `access_zones_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_program_items` ADD CONSTRAINT `event_program_items_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_program_favorites` ADD CONSTRAINT `member_program_favorites_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_program_favorites` ADD CONSTRAINT `member_program_favorites_program_item_id_fkey` FOREIGN KEY (`program_item_id`) REFERENCES `event_program_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_types` ADD CONSTRAINT `ticket_types_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_type_zones` ADD CONSTRAINT `ticket_type_zones_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_type_zones` ADD CONSTRAINT `ticket_type_zones_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `access_zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_issued_by_id_fkey` FOREIGN KEY (`issued_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_revoked_by_id_fkey` FOREIGN KEY (`revoked_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_credentials` ADD CONSTRAINT `ticket_credentials_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_check_ins` ADD CONSTRAINT `ticket_check_ins_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_check_ins` ADD CONSTRAINT `ticket_check_ins_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `access_zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_check_ins` ADD CONSTRAINT `ticket_check_ins_staff_user_id_fkey` FOREIGN KEY (`staff_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_scan_logs` ADD CONSTRAINT `ticket_scan_logs_ticket_id_fkey` FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_scan_logs` ADD CONSTRAINT `ticket_scan_logs_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_scan_logs` ADD CONSTRAINT `ticket_scan_logs_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_scan_logs` ADD CONSTRAINT `ticket_scan_logs_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `access_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_scan_logs` ADD CONSTRAINT `ticket_scan_logs_staff_user_id_fkey` FOREIGN KEY (`staff_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `concierge_requests` ADD CONSTRAINT `concierge_requests_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `concierge_requests` ADD CONSTRAINT `concierge_requests_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `concierge_requests` ADD CONSTRAINT `concierge_requests_assigned_to_id_fkey` FOREIGN KEY (`assigned_to_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `concierge_request_messages` ADD CONSTRAINT `concierge_request_messages_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `concierge_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `concierge_request_messages` ADD CONSTRAINT `concierge_request_messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipients_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_recipients` ADD CONSTRAINT `notification_recipients_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stored_files` ADD CONSTRAINT `stored_files_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log is append-only: UPDATE and DELETE are refused by the triggers below.
-- MySQL triggers cannot intercept TRUNCATE (it needs the DROP privilege), so the runtime
-- application user should not hold DROP / ALTER / TRIGGER on this schema in production; keep a
-- separate owner user for migrations (see Deployment in README.md).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only (UPDATE blocked)';

CREATE TRIGGER `audit_logs_no_delete` BEFORE DELETE ON `audit_logs`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only (DELETE blocked)';
