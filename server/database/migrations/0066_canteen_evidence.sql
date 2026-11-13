ALTER TABLE intake_items ADD COLUMN weight_basis text CHECK (weight_basis IN ('measured_net','payment_derived'));
CREATE TABLE merchant_stall_prices (
  subject_id text NOT NULL REFERENCES principals(id),
  merchant text NOT NULL, stall text NOT NULL, price_name text NOT NULL,
  valid_from date NOT NULL, valid_to_exclusive date,
  terms jsonb NOT NULL, evidence_note text NOT NULL,
  CHECK (valid_to_exclusive IS NULL OR valid_to_exclusive > valid_from),
  PRIMARY KEY(subject_id,merchant,stall,price_name,valid_from)
);
