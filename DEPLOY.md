# Deploy - Jornada de Motorista

## Pré-requisitos

- Node.js 18+ ou Bun
- Conta no serviço de hospedagem (Vercel, Netlify, etc.)

## Variáveis de ambiente

Configure as seguintes variáveis no seu provedor de hospedagem:

| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://logxhbphjtgobvppmyve.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Ver `.env.example` |
| `VITE_SUPABASE_PROJECT_ID` | `logxhbphjtgobvppmyve` |

> **Nota:** Estas são chaves públicas (anon key). É seguro usá-las no frontend.

## Build

```bash
npm install
npm run build
```

Os arquivos de produção serão gerados em `dist/`.

## Hospedagem

### Vercel
1. Importe o repositório no Vercel
2. Configure as variáveis de ambiente acima
3. Framework preset: Vite
4. Build command: `npm run build`
5. Output directory: `dist`

### Netlify
1. Importe o repositório no Netlify
2. Configure as variáveis de ambiente acima
3. Build command: `npm run build`
4. Publish directory: `dist`

### SPA Routing
Como este é um SPA (Single Page Application), configure o servidor para redirecionar todas as rotas para `index.html`. 

- **Vercel**: Crie `vercel.json` com rewrites (já incluído)
- **Netlify**: Crie `public/_redirects` com `/* /index.html 200`

## Arquitetura

- **Frontend**: React + Vite + Tailwind (hospedado externamente)
- **Backend**: Supabase (gerenciado via Lovable Cloud)
  - Banco de dados PostgreSQL
  - Autenticação
  - Edge Functions (autotrac-sync, telemetry-sync, manage-users, etc.)
  - Todas as automações e integrações continuam no Lovable

O frontend se conecta diretamente ao Supabase usando as chaves públicas. Nenhum proxy ou recurso do Lovable é utilizado em runtime.
