-- AlterTable: the Sales viewer role (sees the website's sales, pre-registrations and visits only)
ALTER TABLE `users` MODIFY `role` ENUM('MEMBER', 'CONCIERGE', 'CHECK_IN_STAFF', 'ADMIN', 'SUPER_ADMIN', 'SALES_VIEWER') NOT NULL DEFAULT 'MEMBER';
