# Deploy do Abastecimento BMTOP

## 1. Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Rode o arquivo `supabase/schema.sql`.
4. Copie:
   - `Project URL` para `SUPABASE_URL`
   - `service_role key` para `SUPABASE_SERVICE_ROLE_KEY`

Use a `service_role key` somente na Vercel, nunca no navegador.

## 2. Cloudflare R2

1. Crie um bucket chamado `abastecimento-bmtop`.
2. Crie uma API token/R2 access key com permissao de escrita e leitura nesse bucket.
3. Copie:
   - Account ID para `R2_ACCOUNT_ID`
   - Access Key ID para `R2_ACCESS_KEY_ID`
   - Secret Access Key para `R2_SECRET_ACCESS_KEY`
   - Bucket para `R2_BUCKET`
4. Configure uma URL publica ou dominio para leitura das fotos e coloque em `R2_PUBLIC_URL`.

## 3. Vercel

1. Suba o projeto para um repositorio GitHub.
2. Importe o repositorio na Vercel.
3. Configure as variaveis de ambiente do `.env.example`.
4. Faça deploy.

## 4. Primeiro administrador

Depois do deploy, chame uma vez:

```bash
curl -X POST https://SEU-SITE.vercel.app/api/bootstrap-admin \
  -H "content-type: application/json" \
  -d "{\"secret\":\"SEU_BOOTSTRAP_SECRET\",\"name\":\"Administrador\",\"email\":\"admin@bmtop.local\",\"password\":\"Admin@123\"}"
```

Depois disso, acesse o sistema com o e-mail e senha criados. O endpoint não cria outro admin se já existir usuário.

## 5. Observacoes

- Os dados ficam no Supabase.
- As fotos ficam no Cloudflare R2.
- O navegador guarda apenas o token da sessao.
- Para trocar o admin inicial, crie outro usuario administrador dentro do sistema e desative/remova o temporario no Supabase.
