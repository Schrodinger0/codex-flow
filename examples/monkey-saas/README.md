# Monkey SaaS (MVP API)

Minimal multi-tenant API with auth stubs and Monkeys CRUD, no external dependencies. Uses Node 18+ only.

## Run

- `cd examples/monkey-saas`
- `npm run dev`
- Optional: set `JWT_SECRET` env var (defaults to `DEV_SECRET_CHANGE_ME`).

## Tenancy

- Provide `x-tenant-id: <tenant>` header on every request.
- Tokens include `tenantId` claim; cross-tenant access is rejected.

## Endpoints

- `GET /health` → `{ status: "ok" }`
- `POST /v1/auth/signup` body: `{ email, name? }` → `{ user, token }`
- `POST /v1/auth/login` body: `{ email }` → `{ user, token }`
- `GET /v1/monkeys` (auth) → list
- `POST /v1/monkeys` body: `{ name, species? }` (auth) → created
- `GET /v1/monkeys/:id` (auth) → one
- `PATCH /v1/monkeys/:id` (auth) → updated
- `DELETE /v1/monkeys/:id` (auth) → 204

## Quick test (with curl)

```
TENANT=banana-biz
BASE=http://localhost:4000

# Health
curl -s $BASE/health

# Signup
TOKEN=$(curl -s -H "x-tenant-id: $TENANT" -H 'content-type: application/json' \
  -d '{"email":"ceo@banana.biz","name":"CEO"}' \
  $BASE/v1/auth/signup | jq -r .token)

# Create monkey
curl -s -X POST -H "x-tenant-id: $TENANT" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Bobo","species":"capuchin"}' $BASE/v1/monkeys

# List monkeys
curl -s -H "x-tenant-id: $TENANT" -H "authorization: Bearer $TOKEN" $BASE/v1/monkeys
```

## Notes

- In-memory store; replace with a DB for persistence.
- JWT is HMAC-SHA256 using Node crypto; rotate `JWT_SECRET` in production.
- Add rate limiting, validation, and audit logs before exposing publicly.

