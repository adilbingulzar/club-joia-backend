-- CreateTable: the IP allowlist managed in the admin (/admin/ip-allowlist)
CREATE TABLE `ip_allowlist` (
    `id` VARCHAR(191) NOT NULL,
    `address` VARCHAR(64) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ip_allowlist_address_key`(`address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
