-- SABOR DIGITAL — Schema v2 (PostgreSQL / Neon)
-- Aplicar em banco vazio:  psql "$DATABASE_URL" -f database/schema.sql -f database/functions.sql
-- Todos os horários são TIMESTAMPTZ. Códigos públicos vêm de SEQUENCEs (sem corrida).

-- ---------------------------------------------------------------- sequences
CREATE SEQUENCE seq_customer START 1;
CREATE SEQUENCE seq_session  START 1;
CREATE SEQUENCE seq_account  START 1;
CREATE SEQUENCE seq_order    START 1;
CREATE SEQUENCE seq_product  START 1;
CREATE SEQUENCE seq_alert    START 1;

-- ---------------------------------------------------------------- restaurants
CREATE TABLE restaurants (
  id          SERIAL PRIMARY KEY,
  identifier  VARCHAR(50) UNIQUE NOT NULL,              -- REST-001
  name        VARCHAR(200) NOT NULL,
  phone       VARCHAR(20),
  email       VARCHAR(200),
  address     TEXT,
  logo_url    TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  plan        VARCHAR(50) NOT NULL DEFAULT 'basic'  CHECK (plan IN ('basic','professional','premium')),
  wait_normal_max_min    INTEGER NOT NULL DEFAULT 15,
  wait_attention_max_min INTEGER NOT NULL DEFAULT 25,
  service_fee_percent    NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (service_fee_percent BETWEEN 0 AND 20),
  is_demo     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- users (staff)
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  email         VARCHAR(200) NOT NULL,
  password_hash VARCHAR(300) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','manager','waiter','kitchen')),
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email ON users (lower(email));
CREATE INDEX idx_users_restaurant ON users (restaurant_id);

-- ---------------------------------------------------------------- tables
-- qr_token: token público aleatório. É a única coisa que vai dentro do QR Code.
CREATE TABLE tables (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  identifier    VARCHAR(50) NOT NULL,                   -- MESA-001
  number        INTEGER NOT NULL CHECK (number > 0),
  capacity      INTEGER NOT NULL DEFAULT 4,
  status        VARCHAR(20) NOT NULL DEFAULT 'free'
                CHECK (status IN ('free','occupied','order_received','preparing','awaiting_delivery','awaiting_payment')),
  qr_token      VARCHAR(100) NOT NULL UNIQUE
                DEFAULT (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  qr_active     BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, identifier),
  UNIQUE (restaurant_id, number)
);
CREATE INDEX idx_tables_restaurant ON tables (restaurant_id);

-- ---------------------------------------------------------------- customers
-- CPF e telefone só existem criptografados (AES-256-GCM, feito na aplicação).
-- cpf_hash = HMAC-SHA256(pepper, cpf) permite localizar sem guardar o CPF em claro.
CREATE TABLE customers (
  id              SERIAL PRIMARY KEY,
  restaurant_id   INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  identifier      VARCHAR(50) NOT NULL UNIQUE DEFAULT ('CLI-' || lpad(nextval('seq_customer')::text, 5, '0')),
  name            VARCHAR(200) NOT NULL,
  cpf_encrypted   TEXT NOT NULL,
  cpf_hash        VARCHAR(64) NOT NULL,
  cpf_masked      VARCHAR(20) NOT NULL,
  phone_encrypted TEXT NOT NULL,
  phone_masked    VARCHAR(25) NOT NULL,
  consent_at      TIMESTAMPTZ NOT NULL,
  consent_version VARCHAR(20) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, cpf_hash)
);
CREATE INDEX idx_customers_restaurant ON customers (restaurant_id);

-- ---------------------------------------------------------------- sessions
-- O cliente guarda um token secreto; no banco só o SHA-256 dele.
CREATE TABLE sessions (
  id            SERIAL PRIMARY KEY,
  identifier    VARCHAR(50) NOT NULL UNIQUE DEFAULT ('SES-' || lpad(nextval('seq_session')::text, 5, '0')),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id      INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash    VARCHAR(64) NOT NULL UNIQUE,
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ
);
CREATE INDEX idx_sessions_table ON sessions (table_id, status);
CREATE UNIQUE INDEX uq_sessions_active ON sessions (table_id, customer_id) WHERE status = 'active';

-- ---------------------------------------------------------------- menu
CREATE TABLE categories (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  image_url     TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, name)
);

CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  identifier    VARCHAR(50) NOT NULL UNIQUE DEFAULT ('PROD-' || lpad(nextval('seq_product')::text, 5, '0')),
  name          VARCHAR(200) NOT NULL,
  description   TEXT,
  ingredients   TEXT,
  price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url     TEXT,
  available     BOOLEAN NOT NULL DEFAULT true,   -- falta de estoque/pausa
  active        BOOLEAN NOT NULL DEFAULT true,   -- exclusão lógica
  is_demo       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_restaurant ON products (restaurant_id, category_id);

CREATE TABLE product_addons (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  active        BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_addons_product ON product_addons (product_id);

-- ---------------------------------------------------------------- accounts / orders
CREATE TABLE accounts (
  id            SERIAL PRIMARY KEY,
  identifier    VARCHAR(50) NOT NULL UNIQUE DEFAULT ('CONTA-' || lpad(nextval('seq_account')::text, 5, '0')),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id      INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  waiter_id     INTEGER REFERENCES users(id),                 -- garçom responsável pela mesa
  service_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 10,        -- percentual congelado na abertura da conta
  status        VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','awaiting_payment','closed')),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);
-- no máximo uma conta não encerrada por mesa
CREATE UNIQUE INDEX uq_account_open_per_table ON accounts (table_id) WHERE status <> 'closed';
CREATE INDEX idx_accounts_restaurant ON accounts (restaurant_id, status);

-- Taxa de serviço removida para um cliente específico (quem, quando e por quê ficam registrados).
CREATE TABLE account_fee_waivers (
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  removed_by  INTEGER NOT NULL REFERENCES users(id),
  reason      VARCHAR(200) NOT NULL,
  removed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, customer_id)
);

CREATE TABLE orders (
  id              SERIAL PRIMARY KEY,
  identifier      VARCHAR(50) NOT NULL UNIQUE DEFAULT ('PED-' || lpad(nextval('seq_order')::text, 5, '0')),
  restaurant_id   INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id        INTEGER NOT NULL REFERENCES tables(id),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  session_id      INTEGER NOT NULL REFERENCES sessions(id),
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  idempotency_key VARCHAR(80) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','preparing','ready','delivering','delivered','cancelled')),
  notes           TEXT,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  preparing_at    TIMESTAMPTZ,
  ready_at        TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  UNIQUE (session_id, idempotency_key)
);
CREATE INDEX idx_orders_restaurant ON orders (restaurant_id, status, created_at);
CREATE INDEX idx_orders_account ON orders (account_id);
CREATE INDEX idx_orders_customer ON orders (customer_id);

-- snapshot do produto e do preço no momento do pedido
CREATE TABLE order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_code VARCHAR(50) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(10,2) NOT NULL,
  addons       JSONB NOT NULL DEFAULT '[]'::jsonb,
  addons_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal     NUMERIC(10,2) NOT NULL,
  notes        TEXT
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

-- consumo individual (quem consumiu o quê) — derivado dos pedidos, sempre consistente
CREATE VIEW customer_account_items AS
SELECT o.restaurant_id, o.account_id, o.customer_id, o.id AS order_id, oi.id AS order_item_id,
       oi.quantity, oi.product_name, oi.subtotal AS amount, o.status AS order_status
FROM order_items oi JOIN orders o ON o.id = oi.order_id;

-- ---------------------------------------------------------------- payments
CREATE TABLE payments (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  method        VARCHAR(30) NOT NULL CHECK (method IN ('cash','pix','debit','credit','other')),
  status        VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled')),
  reference     VARCHAR(200),
  registered_by INTEGER REFERENCES users(id),
  confirmed_by  INTEGER REFERENCES users(id),
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_account ON payments (account_id);
CREATE INDEX idx_payments_restaurant ON payments (restaurant_id, confirmed_at);

-- ---------------------------------------------------------------- alerts (chamar garçom)
CREATE TABLE alerts (
  id            SERIAL PRIMARY KEY,
  identifier    VARCHAR(50) NOT NULL UNIQUE DEFAULT ('ALERTA-' || lpad(nextval('seq_alert')::text, 5, '0')),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id      INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  session_id    INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','resolved')),
  attended_by   INTEGER REFERENCES users(id),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- sem alertas duplicados enquanto houver um aberto na mesma mesa
CREATE UNIQUE INDEX uq_alert_open_per_table ON alerts (table_id) WHERE status <> 'resolved';
CREATE INDEX idx_alerts_restaurant ON alerts (restaurant_id, status);

-- ---------------------------------------------------------------- whatsapp
CREATE TABLE whatsapp_shares (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  customer_id   INTEGER REFERENCES customers(id),
  phone_masked  VARCHAR(25) NOT NULL,
  user_id       INTEGER REFERENCES users(id),
  status        VARCHAR(30) NOT NULL DEFAULT 'prepared'
                CHECK (status IN ('prepared','share_started','confirmed_by_staff','failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_account ON whatsapp_shares (account_id);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE SET NULL,
  actor_type    VARCHAR(15) NOT NULL,           -- user | customer | system
  actor_id      VARCHAR(50),
  action        VARCHAR(60) NOT NULL,
  entity        VARCHAR(40) NOT NULL,
  entity_id     VARCHAR(50),
  data          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_restaurant ON audit_logs (restaurant_id, created_at);
