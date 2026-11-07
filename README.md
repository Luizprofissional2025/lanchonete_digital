# SABOR DIGITAL

Cardápio digital por QR Code (um QR por mesa) e gestão de restaurante: pedidos, cozinha, chamado de garçom, garçom por mesa, taxa de serviço, contas por cliente (CPF), pagamentos, WhatsApp (wa.me), vendas e QR Codes.

Stack: React 18 + Vite · Vercel Serverless (uma função, `api/[...route].js`) · Neon Postgres (regras críticas em PL/pgSQL).

## Quatro páginas separadas
| Quem | Endereço | Acesso |
|---|---|---|
| Cliente | `/m/<código-da-mesa>` → `/cardapio` | Só pelo QR Code da mesa |
| Garçom | `/salao` | Login (cadastrado pelo gerente) |
| Cozinha | `/cozinha` | Login único da cozinha |
| Gerente | `/gerencia` (+ abre `/salao` e `/cozinha`) | Login. Cria QR Codes, equipe, taxa, cardápio, vendas |

## Estrutura de pastas
```
.
├── api/
│   └── [...route].js        única função serverless da Vercel (recebe tudo em /api/*)
├── server/
│   ├── router.js            roteador, segurança (headers, CORS, rate limit), formato das respostas
│   ├── common.js            perfis, sessão do cliente, validadores, URL do QR
│   ├── statement.js         texto do demonstrativo (WhatsApp)
│   ├── index.js / dev.js    registro das rotas / servidor local (porta 3001)
│   └── routes/
│       ├── customer.js      login da equipe + fluxo do cliente (QR, identificação, cardápio, pedido, chamar garçom)
│       ├── staff.js         painel: mesas, QR, pedidos, cozinha, alertas, categorias, produtos, clientes
│       ├── accounts.js      contas, taxa de serviço, pagamentos, WhatsApp, relatório de vendas
│       ├── team.js          funcionários, configurações (taxa, tempos), relatório por garçom
│       └── setup.js         criação do primeiro administrador pelo site
├── lib/                     auth (JWT/scrypt), crypto (AES-GCM/HMAC), validações (CPF/telefone), acesso ao Neon
├── database/
│   ├── schema.sql           tabelas
│   ├── functions.sql        regras de negócio (transações)
│   ├── setup.sql            schema + functions juntos (colar no Neon)
│   └── seeds/demo-data.sql  restaurante de demonstração (10 mesas, 25 produtos)
├── src/                     frontend React
│   ├── App.jsx, main.jsx    rotas
│   ├── pages/               HomePage, CustomerIdentification, MenuPage (cliente)
│   │   ├── staff/           AreaShell (login e menu de cada área) e Areas (salão, cozinha, gerência)
│   │   └── admin/           telas: mesas/contas, cozinha, QR Codes, cardápio, equipe, vendas, setup
│   ├── components/ hooks/ services/ styles/ utils/
├── scripts/create-admin.js  alternativa por terminal para criar usuários
├── tests/                   51 testes (precisam de Postgres local)
├── docs/                    DEPLOY.md (passo a passo), PROGRESSO.md, protótipo de usabilidade
├── .env.example             modelo das variáveis
├── vercel.json, vite.config.js, package.json, index.html
```

## Variáveis (Vercel → Settings → Environment Variables)
`DATABASE_URL` · `JWT_SECRET` · `FIELD_ENCRYPTION_KEY` · `HASH_PEPPER` · `APP_BASE_URL` · `SETUP_TOKEN` (explicação completa em `docs/DEPLOY.md`).

## Começar
Leia **docs/DEPLOY.md**: GitHub, Neon, variáveis e primeiro acesso.

## Segurança e LGPD
CPF e celular criptografados (AES-256-GCM) com hash HMAC para busca, sempre mascarados na tela; o QR leva só um token aleatório da mesa; isolamento por restaurante; perfil conferido no servidor a cada chamada; preços lidos do banco; pedidos idempotentes; senhas com scrypt.
