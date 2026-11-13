CREATE TABLE return_cases (
  id text PRIMARY KEY,subject_id text NOT NULL REFERENCES principals(id),purchase_item_id text NOT NULL REFERENCES purchase_items(id),
  currency text NOT NULL,expected_amount numeric(24,6) NOT NULL CHECK(expected_amount>0),returned_on date,note text,revision integer NOT NULL DEFAULT 1
);
CREATE INDEX return_cases_item ON return_cases(subject_id,purchase_item_id);
CREATE TABLE return_allocations (
  case_id text NOT NULL REFERENCES return_cases(id) ON DELETE CASCADE,refund_entry_id text NOT NULL REFERENCES money_entries(id),
  amount numeric(24,6) NOT NULL CHECK(amount>0),PRIMARY KEY(case_id,refund_entry_id)
);
CREATE INDEX return_allocations_entry ON return_allocations(refund_entry_id);
CREATE VIEW active_purchase_refunds AS
SELECT orig.record_id,f.subject_id,b.id refund_entry_id,b.amount,b.currency
FROM refunds f JOIN money_entries orig ON orig.id=f.original_entry_id AND orig.subject_id=f.subject_id
JOIN money_entries b ON b.id=f.refund_entry_id AND b.subject_id=f.subject_id
JOIN consumption_records r ON r.id=b.record_id AND r.state='confirmed' WHERE f.link_state='linked';
