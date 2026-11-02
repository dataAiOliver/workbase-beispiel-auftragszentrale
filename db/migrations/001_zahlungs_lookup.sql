-- Schnelle Zuordnung eingehender Zahlungsereignisse (Webhook-Prüfung, Detailansicht).
create index if not exists orders_payment_id_idx on orders (payment_id);
create index if not exists payments_event_id_idx on payments (event_id);
create index if not exists payments_payment_id_idx on payments (payment_id);
