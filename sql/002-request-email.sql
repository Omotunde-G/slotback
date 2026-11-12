CREATE UNIQUE INDEX one_email_per_slot
  ON slot_requests (slot_id, lower(customer_email));
  