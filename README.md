# Donna Legal Co-pilot (V2.1)
> **An Enterprise-Grade Strategic Legal AI Assistant & Compliance calculated deadline ecosystem for Brazilian Law Firms.**

Donna is a state-of-the-art legal co-pilot designed to automate procedural deadlines under Brazilian law (CPC/15 and CNJ regulations), parse Official Judicial Gazettes (Diários Oficiais) using cognitive AI, manage magistrate behavioral profiles, and serve as an advanced semantic strategic advisor (RAG) for litigation teams.

Built with a **deterministic regulatory engine** and a **resilient hybrid database architecture**, Donna guarantees LGPD multi-tenant isolation and 100% system availability, even in offline or high-latency environments.

---

## Key Architectural Features

*   **Motor 3: Timezone-Locked Procedural Deadline Engine:** Evaluates calculated deadlines under strict CPC/15 and CNJ Resolutions 455/2022 and 569/2024. Implements precise calculations for DJEN, Domicílio Eletrônico (5th business day citação), 10 calendar days tacit service window, and automatic blocking + high-risk warnings for PJ Private citação inertia (avoiding the 5% fine under Art. 246, §1º-C).
*   **Logical Multi-Tenancy (Supabase RLS & JWT Claims):** Strict database-level isolation. Queries do not accept tenant IDs via URL or body parameters; instead, PostgreSQL decodes `escritorio_id` directly from the authenticated JWT session settings, eliminating cross-tenant data leaks.
*   **Two-Phase Offline Resilience Roadmap:**
    *   *Phase 1 (Current):* Promise-based transaction queue lock (`jsonMutex.js` `safeUpdate`) serializing local JSON reads and writes to prevent data corruption during concurrency spikes.
    *   *Phase 2 (Target):* Native local relational SQLite database with downstream background worker synchronization (`sync_status`, `sync_error`).
*   **Magistrate Dossier & Strategic Profiling:** Sophisticated profiling of court actors (`atores_judiciario`) mapping decision styles (*legalista*, *garantista*), courtroom temperaments, and strategic advice, enriched with trust levels (`1-5`) and source proveniences.
*   **Canonically Normalized Chat Memory:** High-speed chat sessions storing independent message lines in `mensagens_sessao` ordered by sequence keys, enabling swift context summaries and reduced LLM API latency.
*   **Operational Telemetry:** Real-time health metrics including pending tenant queues, cognitive parser success rates, local fallback frequency, and external API error thresholds (Evolution WhatsApp, Resend, Gemini).

---

## Project Structure

```bash
d:\Donna
├── frontend/                     # Next.js 16 Webpack Client application
├── n8n/                          # n8n workflow triggers and automation configurations
├── src/
│   ├── config/
│   │   ├── supabase.js           # Supabase Cloud client initialization
│   │   ├── jsonMutex.js          # Promise-based file transaction lock utility (Phase 1)
│   │   └── *donna.json           # Local JSON databases (Ignored in Git)
│   ├── routes/
│   │   ├── donnaRoutes.js        # Normalized chat routes & fallback memory
│   │   └── processoRoutes.js     # Lawsuits & magistrate profiling endpoints
│   ├── services/
│   │   └── deadlineService.js    # Motor 3: Timezone-locked CNJ calculation engine
│   └── scratch/                  # Pragmatic automated verification suite
│       ├── verify_precise_deadlines.js    # CNJ & Domicílio calculation tests
│       ├── verify_tenant_isolation.js     # RLS tenant leak prevention tests
│       ├── verify_mutex.js                # Concurrency stress tests
│       └── verify_timezone.js             # UTC-3 Brasília timezone lock tests
├── schema.sql                    # Production DDL database migration script (V2.1)
├── .env.example                  # Environment configuration template
├── .gitignore                    # Robust git exclusion registry
└── README.md                     # This master documentation
```

---

## Local Installation & Setup

### Prerequisites
*   Node.js (v18 or higher)
*   npm or yarn

### 1. Clone the repository and install dependencies
```bash
git clone <your-github-repo-url>
cd Donna
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` (the `.env` file is excluded from Git tracking to ensure absolute security and prevent credentials leaks):
```bash
cp .env.example .env
```
Fill in the credentials inside `.env`:
*   `GEMINI_API_KEY`: Google Gemini Studio Key.
*   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: Production Supabase credentials.

### 3. Run Database Migrations
Copy the entire content of [`schema.sql`](file:///d:/Donna/schema.sql) and execute it in the **SQL Editor** of your Supabase console. This will initialize the enums, tables, composite indexes, pgvector searches, and JWT-claim RLS policies.

### 4. Start the Application
To run the Fastify backend server (running on port `3000` by default):
```bash
npm run dev
```

To run the Next.js frontend client (running on port `3001` in custom Webpack mode):
```bash
cd frontend
npm run dev
```

---

## Automated Verification Suite

Donna incorporates a rigorous test suite inside `src/scratch/` that validates core functionalities locally before committing code changes:

*   **Calculation Precision (`verify_precise_deadlines.js`):** Simulates DJEN, active citação confirmations, citação inertias (PJ Private locking), and tacit 10 calendar days notifications.
    ```bash
    node src/scratch/verify_precise_deadlines.js
    ```
*   **Multi-Tenant Isolation (`verify_tenant_isolation.js`):** Confirms PostgreSQL RLS policies block cross-tenant visibility.
    ```bash
    node src/scratch/verify_tenant_isolation.js
    ```
*   **Transactional Concurrency (`verify_mutex.js`):** Fires 20 simultaneous updates to check for local file corruption.
    ```bash
    node src/scratch/verify_mutex.js
    ```
*   **Timezone Locks (`verify_timezone.js`):** Tests date manipulation in GMT-0300 (Brasília), ensuring complete server-drift immunity.
    ```bash
    node src/scratch/verify_timezone.js
    ```

---

## Security Compliance

*   **Credentials Protection:** The `.gitignore` registry excludes all `.env` files, preventing API keys, passwords, and private URLs from ever being pushed to public repositories.
*   **No local dumps in Git:** Local fallback data files (`conversas_donna.json`, `processos_donna.json`, etc.) are fully ignored to prevent local development database dumps from leaking client data.
*   **Decoupled Multi-Tenancy:** Secure session-setting queries ensure that SQL queries are filtered at the database level using RLS, enforcing zero client-side tenant injection paths.
