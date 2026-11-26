-- AlterTable: the Backoffice role (Sales, Payment links, Members, Tickets, Concierge, Notifications, Open scan)
ALTER TABLE `users` MODIFY `role` ENUM('MEMBER', 'CONCIERGE', 'CHECK_IN_STAFF', 'ADMIN', 'SUPER_ADMIN', 'SALES_VIEWER', 'BACKOFFICE') NOT NULL DEFAULT 'MEMBER';
