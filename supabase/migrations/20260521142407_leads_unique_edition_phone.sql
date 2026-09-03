-- The leads endpoint upserts on (edition_id, phone). The original index
-- was non-unique, so upsert with onConflict couldn't resolve. Swap for a
-- unique index.

drop index if exists leads_edition_phone;
create unique index leads_edition_phone_unique on leads(edition_id, phone);
