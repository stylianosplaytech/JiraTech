import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

const DESCRIPTION = `
The Conductor REST API: the same one the web app uses.

**Authentication.** Send \`Authorization: Bearer <token>\`, where the token is either an **API token** (\`jt_…\`, created under *API tokens* in
your profile menu: read-only or read and write) or the \`accessToken\` returned by \`POST /api/auth/login\`. Either way you act as that user, with
exactly the access they have. Use **Authorize** below to try requests from this page.

**Projects.** Endpoints that work inside one project (issues list, board, labels, versions, components, planning…) take the project from the
\`X-Project-Key\` header or the \`?project=KEY\` query, defaulting to SPORTS. Issues can be addressed by id or by key (\`HELP-12\`).

**Errors.** \`400\` with a \`message\` for invalid input, \`401\` for a missing or invalid token, \`403\` for access you don't have (or a read-only
token used for a change), \`404\` for something that doesn't exist or isn't visible to you.

Request bodies and parameters are documented here; response bodies are not described in detail yet: they are the JSON the web app shows.
Guides: *API tokens and webhooks* (docs/API-INTEGRATIONS.md) and *Automation rules* (docs/AUTOMATION.md).
`.trim();

/** URL prefix → how the section is named in the docs (anything else is its path segment, capitalised). */
const TAG_NAMES: Record<string, string> = {
  auth: 'Authentication',
  'api-tokens': 'API tokens',
  hooks: 'Incoming webhook receiver',
  'inbound-webhooks': 'Incoming webhooks (setup)',
  webhooks: 'Webhooks (outgoing)',
  automation: 'Automation rules',
  'service-desk': 'Service desk',
  portal: 'Help center (portal)',
  'service-notices': 'Service notices',
  'notification-scheme': 'Notification scheme',
  'mail-settings': 'Email settings',
  'email-templates': 'Email templates',
  'recipient-groups': 'Recipient groups',
  'custom-fields': 'Custom fields',
  search: 'Search and filters',
  filters: 'Search and filters',
  planning: 'Planning',
  scheduling: 'Scheduling',
  releases: 'Releases',
  incidents: 'Incidents',
  dashboard: 'Dashboard',
  dashboards: 'Custom dashboards',
  reports: 'Reports',
  board: 'Board',
  health: 'Health',
};

/** Routes that need no token. */
const PUBLIC_ROUTES = [
  /^\/api\/auth\/(login|forgot-password|set-password|password-links\/)/,
  /^\/api\/hooks\//,
  /^\/api\/health/,
  /^\/api\/mail-settings\/google\/callback/,
];

const tagFor = (path: string) => {
  const segment = path.split('/')[2] ?? '';
  return TAG_NAMES[segment] ?? (segment ? segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ') : 'Other');
};

/** Groups operations into sections, marks the open ones, and notes the errors every protected one can give. */
function tidy(document: OpenAPIObject) {
  const tags = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    const open = PUBLIC_ROUTES.some((r) => r.test(path));
    for (const operation of Object.values(item ?? {})) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      const tag = tagFor(path);
      tags.add(tag);
      operation.tags = [tag];
      // Controllers without a comment on a route get its method name as words: getCandidates → "Get candidates".
      if (!operation.summary && operation.operationId) {
        const words = operation.operationId.split('_').pop()!.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
        operation.summary = words.charAt(0).toUpperCase() + words.slice(1);
      }
      if (open) {
        operation.security = [];
      } else {
        operation.responses['401'] ??= { description: 'Missing, invalid, expired or revoked token' };
        operation.responses['403'] ??= { description: 'Your role or token does not allow this' };
      }
    }
  }
  document.tags = [...tags].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
}

/**
 * Serves the API description at /api/openapi.json and an interactive page at /api/docs. The routes, parameters and request
 * bodies are read from the controllers and validation classes when the app is built (see nest-cli.json), so they can't drift.
 * API_DOCS=false switches both off.
 */
export function setupOpenApi(app: INestApplication) {
  if (process.env.API_DOCS === 'false') return;
  const config = new DocumentBuilder()
    .setTitle('Conductor API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API token (jt_…) or login JWT', description: 'An API token, or the accessToken from POST /api/auth/login' })
    .addSecurityRequirements('bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  tidy(document);
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    jsonDocumentUrl: 'openapi.json',
    customSiteTitle: 'Conductor API',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha', operationsSorter: 'alpha' },
  });
}
