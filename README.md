# Nordwerk Auftragszentrale

Interne Ops-Konsole von **Nordwerk Handel**: Bestellungen aus Webshop und B2B, Zahlungseingänge
des Zahlungsanbieters PayNord und das Rechnungsarchiv.

* **PostgreSQL**: `customers`, `products`, `orders`, `order_items`, `payments`
  (Schema `db/schema.sql`, Migrationen `db/migrations/NNN_*.sql`).
* **S3**: Rechnungsdokumente als JSON unter `invoices/<jahr>/<bestellnummer>.json`.
* **PayNord**: liefert `payment.succeeded`-Ereignisse per Webhook. Daraus entstehen Bestellung,
  Positionen, Zahlung und das Rechnungsdokument.

## Start

```bash
npm install
cp .env.example .env   # Werte anpassen und exportieren
PORT=4200 node server.mjs
```

Beim Start wendet die App `db/schema.sql` und alle noch nicht angewendeten Migrationen an
(Tabelle `schema_migrations`, serialisiert per Advisory-Lock), setzt die ID-Sequenzen hinter
die höchste vorhandene ID (Stage-Daten werden mit expliziten IDs geladen) und legt den Bucket
an, falls er fehlt.

## Oberfläche

* **Auftragsliste** mit Kennzahlen, Suche (Bestellnummer, Kunde, Zahlungs-ID), Statusfilter
  und Blättern. Zahlungen, die mehreren Bestellungen zugeordnet sind, werden markiert.
* **Detailansicht** (Seitenpanel): Kunde, Positionen, Zahlungen und Rechnungsvorschau aus dem
  Archiv (inkl. Hinweis, wenn kein Rechnungsdokument existiert).
* **Zahlungseingang simulieren**: baut ein PayNord-Ereignis und stellt es zu – einmal,
  „Erneut zustellen“ (gleiche `event_id`) oder „Zweimal gleichzeitig zustellen“.

## API

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET  | `/api/orders?q=&status=&limit=&offset=` | Bestellliste mit Filtern |
| GET  | `/api/orders/:id` | Bestellung mit Kunde, Positionen, Zahlungen, Rechnungsschlüssel |
| GET  | `/api/invoices/:orderNumber` | Rechnungsdokument aus S3 (`404`, wenn nicht im Archiv) |
| POST | `/api/webhooks/payment` | PayNord-Webhook (siehe unten) |
| GET  | `/api/stats` | Kennzahlen |
| GET  | `/api/products` | Artikelstamm (für den Simulator) |
| GET  | `/api/meta` | Projekt, Stage, Datenstand, Commit, Anbieter-URL, Bucket |
| GET  | `/__health` | `{"ok":true,"project","stage","commit","dataset"}` |
| POST | `/__workbase/telemetry` | Browser-Telemetrie (nur `204`) |

### Webhook `POST /api/webhooks/payment`

```json
{
  "event_id": "evt_…", "type": "payment.succeeded", "payment_id": "pn_…",
  "amount_cents": 16880, "currency": "EUR",
  "customer": { "name": "…", "email": "…@example.invalid", "street": "…", "postcode": "…", "city": "…", "country": "DE" },
  "items": [ { "sku": "NW-JK-FJELL", "quantity": 1, "unit_price_cents": 12900 } ]
}
```

Antworten: `201 {"status":"created","order_id","order_number","invoice_key"}`,
`200` für bereits verbuchte Ereignisse, `202` für nicht verarbeitete Ereignistypen,
`422` für unvollständige Ereignisse.

## Umgebungsvariablen

| Variable | Bedeutung |
|----------|-----------|
| `PORT` (Pflicht), `HOST` | HTTP-Server |
| `DATABASE_URL` | PostgreSQL-Verbindung |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Rechnungsarchiv (Path-Style) |
| `PAYMENT_PROVIDER_URL` | PayNord-API (nur Anzeige/Konfiguration) |
| `WORKBASE_PROJECT`, `WORKBASE_STAGE`, `WORKBASE_DATASET_LABEL`, `WORKBASE_COMMIT` | Anzeige / Fallback |

## Tests und Build

```bash
npm test        # node:test gegen echte Datenbank und echten Bucket (Umgebung wie oben)
npm run build   # Syntaxprüfung + gehashte Assets nach dist/
```

Die Tests starten die App im Testprozess auf einem freien Port und verwenden eindeutige
Ereignis- und Zahlungs-IDs; sie sind wiederholbar und benötigen keine leere Datenbank.
