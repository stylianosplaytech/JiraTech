# Digital Ticketing Helm chart

This chart deploys the React frontend and NestJS backend as two containers in one pod. Nginx serves the
frontend and proxies `/api` to the backend over localhost. One `ReadWriteOnce` volume stores the SQLite
database and uploaded attachments, so the deployment intentionally uses one replica and `Recreate`.

## First esto-dev deployment

1. Import `pipeline/build.yml` into Codefresh.
2. Bind the Stash integration, the `nexus_pbs_one` registry integration, and the secret `npmToken`.
3. Run the build with `IMAGE_TAG=0.1.0`; this creates both image tags referenced by the Argo values file.
4. Create `digital-ticketing-app-secrets` in `dgt-moj-digital-ticketing-1` with at least a strong
   `JWT_SECRET`. Add SMTP credentials there when email delivery is required.
5. Configure the Argo CD application to use `helm/digital-ticketing` with
   `argocd/environments/dgt-moj-digital-ticketing-1/values.yaml`.

The environment intentionally has no `imagePullSecret`; esto-dev provides registry authentication at node
level, matching the `devops-monitoring` migration.

For an external PostgreSQL database, put `DATABASE_URL` in the application Secret. Secret values loaded by
`envFrom` override no explicit value, so also remove `backend.env.DATABASE_URL` from the environment values
file when switching away from SQLite.
