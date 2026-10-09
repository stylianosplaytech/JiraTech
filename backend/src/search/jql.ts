import { IssueResolution, IssueStatus, IssueType, Priority, Prisma } from '@prisma/client';
import { contains } from '../common/text-match';

/**
 * A small JQL (Jira Query Language) implementation.
 *
 *   query    := orExpr? ("ORDER BY" sortKey ("," sortKey)*)?
 *   orExpr   := andExpr ("OR" andExpr)*
 *   andExpr  := notExpr ("AND" notExpr)*
 *   notExpr  := "NOT" notExpr | "(" orExpr ")" | clause
 *   clause   := field op value
 *   op       := = | != | ~ | !~ | > | >= | < | <= | IN | NOT IN | IS | IS NOT
 *   value    := word | "quoted" | function() | EMPTY | NULL | "(" value ("," value)* ")"
 *
 * Examples:
 *   project = SPORTS AND status != Closed ORDER BY priority DESC
 *   assignee = currentUser() AND type IN (Story, Defect)
 *   text ~ "login" AND created >= -7d
 */

export class JqlError extends Error {}

export interface JqlContext {
  currentUserId: string;
  now?: Date;
}

export type SortField = 'created' | 'updated' | 'priority' | 'status' | 'key' | 'summary' | 'type' | 'assignee';

export interface JqlSort {
  field: SortField;
  direction: 'asc' | 'desc';
}

export interface CompiledJql {
  where: Prisma.IssueWhereInput;
  orderBy: JqlSort[];
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type TokenKind = 'word' | 'string' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

const OPERATORS = ['!=', '!~', '>=', '<=', '=', '~', '>', '<'];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch, pos: i++ });
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch, pos: i++ });
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ch, pos: i++ });
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i++;
      let value = '';
      while (i < input.length && input[i] !== ch) {
        if (input[i] === '\\' && i + 1 < input.length) i++;
        value += input[i++];
      }
      if (i >= input.length) throw new JqlError(`Unterminated string starting at position ${start + 1}`);
      i++;
      tokens.push({ kind: 'string', value, pos: start });
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', value: op, pos: i });
      i += op.length;
      continue;
    }
    const match = /^[A-Za-z0-9_.@+\-:/]+/.exec(input.slice(i));
    if (!match) throw new JqlError(`Unexpected character '${ch}' at position ${i + 1}`);
    tokens.push({ kind: 'word', value: match[0], pos: i });
    i += match[0].length;
  }
  tokens.push({ kind: 'eof', value: '', pos: input.length });
  return tokens;
}

// ─── AST ─────────────────────────────────────────────────────────────────────

type Value =
  | { kind: 'literal'; value: string }
  | { kind: 'function'; name: string }
  | { kind: 'empty' };

type Node =
  | { kind: 'and'; nodes: Node[] }
  | { kind: 'or'; nodes: Node[] }
  | { kind: 'not'; node: Node }
  | { kind: 'clause'; field: string; op: string; values: Value[]; pos: number };

// ─── Parser ──────────────────────────────────────────────────────────────────

class Parser {
  private i = 0;

  constructor(private tokens: Token[]) {}

  parse(): { node: Node | null; sort: JqlSort[] } {
    let node: Node | null = null;
    if (!this.atKeyword('ORDER') && this.peek().kind !== 'eof') {
      node = this.parseOr();
    }
    const sort: JqlSort[] = [];
    if (this.atKeyword('ORDER')) {
      this.next();
      this.expectKeyword('BY');
      do {
        const fieldTok = this.expectValueToken('sort field');
        const field = SORT_FIELDS[normalizeField(fieldTok.value)];
        if (!field) throw new JqlError(`Cannot sort by '${fieldTok.value}'`);
        let direction: 'asc' | 'desc' = field === 'created' || field === 'updated' ? 'desc' : 'asc';
        if (this.atKeyword('ASC')) {
          this.next();
          direction = 'asc';
        } else if (this.atKeyword('DESC')) {
          this.next();
          direction = 'desc';
        }
        sort.push({ field, direction });
      } while (this.peek().kind === 'comma' && this.next());
    }
    const tok = this.peek();
    if (tok.kind !== 'eof') throw new JqlError(`Unexpected '${tok.value}' at position ${tok.pos + 1}`);
    return { node, sort };
  }

  private parseOr(): Node {
    const nodes = [this.parseAnd()];
    while (this.atKeyword('OR')) {
      this.next();
      nodes.push(this.parseAnd());
    }
    return nodes.length === 1 ? nodes[0] : { kind: 'or', nodes };
  }

  private parseAnd(): Node {
    const nodes = [this.parseNot()];
    while (this.atKeyword('AND')) {
      this.next();
      nodes.push(this.parseNot());
    }
    return nodes.length === 1 ? nodes[0] : { kind: 'and', nodes };
  }

  private parseNot(): Node {
    if (this.atKeyword('NOT')) {
      this.next();
      return { kind: 'not', node: this.parseNot() };
    }
    if (this.peek().kind === 'lparen') {
      this.next();
      const node = this.parseOr();
      this.expect('rparen', "')'");
      return node;
    }
    return this.parseClause();
  }

  private parseClause(): Node {
    const fieldTok = this.expectValueToken('field name');
    const op = this.parseOperator();
    let values: Value[];
    if (op === 'IN' || op === 'NOT IN') {
      this.expect('lparen', `'(' after ${op}`);
      values = [this.parseValue()];
      while (this.peek().kind === 'comma') {
        this.next();
        values.push(this.parseValue());
      }
      this.expect('rparen', "')'");
    } else {
      values = [this.parseValue()];
    }
    return { kind: 'clause', field: fieldTok.value, op, values, pos: fieldTok.pos };
  }

  private parseOperator(): string {
    const tok = this.peek();
    if (tok.kind === 'op') {
      this.next();
      return tok.value;
    }
    if (this.atKeyword('IN')) {
      this.next();
      return 'IN';
    }
    if (this.atKeyword('IS')) {
      this.next();
      if (this.atKeyword('NOT')) {
        this.next();
        return 'IS NOT';
      }
      return 'IS';
    }
    if (this.atKeyword('NOT')) {
      this.next();
      this.expectKeyword('IN');
      return 'NOT IN';
    }
    throw new JqlError(`Expected an operator at position ${tok.pos + 1} but found '${tok.value || 'end of query'}'`);
  }

  private parseValue(): Value {
    const tok = this.expectValueToken('value');
    if (tok.kind === 'word') {
      const upper = tok.value.toUpperCase();
      if (upper === 'EMPTY' || upper === 'NULL') return { kind: 'empty' };
      if (this.peek().kind === 'lparen' && this.tokens[this.i + 1]?.kind === 'rparen') {
        this.next();
        this.next();
        return { kind: 'function', name: tok.value.toLowerCase() };
      }
    }
    return { kind: 'literal', value: tok.value };
  }

  private peek() {
    return this.tokens[this.i];
  }

  private next() {
    return this.tokens[this.i++];
  }

  private atKeyword(word: string) {
    const tok = this.peek();
    return tok.kind === 'word' && tok.value.toUpperCase() === word;
  }

  private expectKeyword(word: string) {
    if (!this.atKeyword(word)) {
      const tok = this.peek();
      throw new JqlError(`Expected '${word}' at position ${tok.pos + 1}`);
    }
    this.next();
  }

  private expect(kind: TokenKind, what: string) {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new JqlError(`Expected ${what} at position ${tok.pos + 1} but found '${tok.value || 'end of query'}'`);
    }
    return this.next();
  }

  private expectValueToken(what: string) {
    const tok = this.peek();
    if (tok.kind !== 'word' && tok.kind !== 'string') {
      throw new JqlError(`Expected ${what} at position ${tok.pos + 1} but found '${tok.value || 'end of query'}'`);
    }
    return this.next();
  }
}

// ─── Field definitions ───────────────────────────────────────────────────────

const normalizeField = (f: string) => f.toLowerCase().replace(/[\s_-]/g, '');

const SORT_FIELDS: Record<string, SortField> = {
  created: 'created',
  createddate: 'created',
  updated: 'updated',
  updateddate: 'updated',
  priority: 'priority',
  status: 'status',
  key: 'key',
  issuekey: 'key',
  summary: 'summary',
  type: 'type',
  issuetype: 'type',
  assignee: 'assignee',
};

const toEnumKey = (v: string) => v.trim().toUpperCase().replace(/[\s-]+/g, '_');

const TYPE_ALIASES: Record<string, IssueType> = {
  BUG: IssueType.DEFECT,
  SUBTASK: IssueType.SUB_TASK,
  FEATURE: IssueType.FEATURE_EPIC,
};

const STATUS_ALIASES: Record<string, IssueStatus> = {
  OPEN: IssueStatus.TO_DO,
  TODO: IssueStatus.TO_DO,
  IN_PROGRESS: IssueStatus.DOING,
  INPROGRESS: IssueStatus.DOING,
  DONE: IssueStatus.CLOSED,
  RESOLVED: IssueStatus.CLOSED,
};

const RESOLUTION_ALIASES: Record<string, IssueResolution> = {
  DONE: IssueResolution.COMPLETED,
  FIXED: IssueResolution.COMPLETED,
  WONT_DO: IssueResolution.REJECTED,
  WONT_FIX: IssueResolution.REJECTED,
};

/** SQLite comparisons are case-sensitive: try the common spellings of a status name. */
function nameVariants(v: string): string[] {
  const t = v.trim();
  const title = t.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  return [...new Set([t, t.toLowerCase(), t.toUpperCase(), title])];
}

function tryEnum<T extends string>(raw: string, values: Record<string, T>, aliases: Record<string, T>): T | undefined {
  const key = toEnumKey(raw);
  return (values as Record<string, T>)[key] ?? aliases[key] ?? aliases[key.replace(/_/g, '')];
}

function enumValue<T extends string>(
  raw: string,
  values: Record<string, T>,
  aliases: Record<string, T>,
  fieldName: string,
): T {
  const key = toEnumKey(raw);
  const value = (values as Record<string, T>)[key] ?? aliases[key] ?? aliases[key.replace(/_/g, '')];
  if (!value) {
    throw new JqlError(
      `'${raw}' is not a valid ${fieldName}. Valid values: ${Object.values(values).join(', ')}`,
    );
  }
  return value;
}

type ClauseNode = Extract<Node, { kind: 'clause' }>;

class Compiler {
  constructor(private ctx: JqlContext) {}

  compile(node: Node): Prisma.IssueWhereInput {
    switch (node.kind) {
      case 'and':
        return { AND: node.nodes.map((n) => this.compile(n)) };
      case 'or':
        return { OR: node.nodes.map((n) => this.compile(n)) };
      case 'not':
        return { NOT: this.compile(node.node) };
      case 'clause':
        return this.clause(node);
    }
  }

  private clause(c: ClauseNode): Prisma.IssueWhereInput {
    const field = normalizeField(c.field);
    switch (field) {
      case 'project':
        return this.equality(c, (v) => ({ project: { key: v.toUpperCase() } }));
      case 'key':
      case 'issuekey':
      case 'issue':
      case 'id':
        return this.equality(c, (v) => ({ key: v.toUpperCase() }));
      case 'type':
      case 'issuetype':
        return this.equality(c, (v) => ({ type: enumValue(v, IssueType, TYPE_ALIASES, 'issue type') }));
      case 'status':
        return this.equality(c, (v) => {
          const byName: Prisma.IssueWhereInput = { workflowStatus: { name: { in: nameVariants(v) } } };
          const category = tryEnum(v, IssueStatus, STATUS_ALIASES);
          return category ? { OR: [byName, { status: category }] } : byName;
        });
      case 'statuscategory':
        return this.equality(c, (v) => ({ status: enumValue(v, IssueStatus, STATUS_ALIASES, 'status category') }));
      case 'priority':
        return this.equality(c, (v) => ({ priority: enumValue(v, Priority, {}, 'priority') }));
      case 'resolution':
        return this.equality(
          c,
          (v) => (toEnumKey(v) === 'UNRESOLVED'
            ? { resolution: null }
            : { resolution: enumValue(v, IssueResolution, RESOLUTION_ALIASES, 'resolution') }),
          { resolution: null },
        );
      case 'assignee':
        return this.userField(c, 'assignee', 'assigneeId');
      case 'reporter':
        return this.userField(c, 'reporter', 'reporterId');
      case 'watcher':
        return this.equality(
          c,
          (v) => ({ watchers: { some: { user: this.userMatch(v) } } }),
          { watchers: { none: {} } },
          true,
        );
      case 'labels':
      case 'label':
        return this.equality(
          c,
          (v) => ({ labels: { some: { label: { name: v } } } }),
          { labels: { none: {} } },
          true,
        );
      case 'component':
      case 'components':
        return this.equality(
          c,
          (v) => ({ components: { some: { component: { name: v } } } }),
          { components: { none: {} } },
          true,
        );
      case 'fixversion':
        return this.equality(
          c,
          (v) => ({ versions: { some: { isFix: true, version: { name: v } } } }),
          { versions: { none: { isFix: true } } },
          true,
        );
      case 'affectedversion':
      case 'affectsversion':
        return this.equality(
          c,
          (v) => ({ versions: { some: { isFix: false, version: { name: v } } } }),
          { versions: { none: { isFix: false } } },
          true,
        );
      case 'sprint':
        return this.equality(c, (v) => ({ sprint: { name: v } }), { sprintId: null });
      case 'parent':
        return this.equality(c, (v) => ({ parent: { key: v.toUpperCase() } }), { parentId: null });
      case 'epicname':
        return this.equality(c, (v) => ({ epicName: v }), { epicName: null });
      case 'blocked':
        return this.equality(c, (v) => ({ blocked: ['true', 'yes', '1'].includes(v.toLowerCase()) }));
      case 'summary':
        return this.text(c, (v) => ({ summary: contains(v) }));
      case 'description':
        return this.text(c, (v) => ({ description: contains(v) }), { description: null });
      case 'comment':
        return this.text(c, (v) => ({ comments: { some: { body: contains(v) } } }));
      case 'text':
        return this.text(c, (v) => ({
          OR: [
            { summary: contains(v) },
            { description: contains(v) },
            { key: contains(v.toUpperCase()) },
            { comments: { some: { body: contains(v) } } },
          ],
        }));
      case 'created':
      case 'createddate':
        return this.date(c, 'createdAt');
      case 'updated':
      case 'updateddate':
        return this.date(c, 'updatedAt');
      default:
        throw new JqlError(
          `Unknown field '${c.field}'. Try: project, key, type, status, priority, resolution, assignee, reporter, ` +
          'statusCategory, watcher, labels, component, fixVersion, affectedVersion, sprint, parent, summary, description, ' +
          'comment, text, created, updated, blocked',
        );
    }
  }

  /** =, !=, IN, NOT IN, IS EMPTY, IS NOT EMPTY for exact-match fields. */
  private equality(
    c: ClauseNode,
    match: (value: string) => Prisma.IssueWhereInput,
    emptyMatch?: Prisma.IssueWhereInput,
    // Multi-valued fields (labels, components…): "!=" means "has none of these".
    multiValued = false,
  ): Prisma.IssueWhereInput {
    const literal = (v: Value) => this.literal(c, v);
    switch (c.op) {
      case '=':
      case 'IS':
        if (c.values[0].kind === 'empty') return this.requireEmpty(c, emptyMatch);
        if (c.op === 'IS') throw new JqlError(`'IS' can only be used with EMPTY (field '${c.field}')`);
        return match(literal(c.values[0]));
      case '!=':
      case 'IS NOT':
        if (c.values[0].kind === 'empty') return { NOT: this.requireEmpty(c, emptyMatch) };
        if (c.op === 'IS NOT') throw new JqlError(`'IS NOT' can only be used with EMPTY (field '${c.field}')`);
        return this.notMatch(match(literal(c.values[0])), emptyMatch, multiValued);
      case 'IN':
        return { OR: c.values.map((v) => (v.kind === 'empty' ? this.requireEmpty(c, emptyMatch) : match(literal(v)))) };
      case 'NOT IN':
        return {
          AND: c.values.map((v) => (v.kind === 'empty'
            ? { NOT: this.requireEmpty(c, emptyMatch) }
            : this.notMatch(match(literal(v)), emptyMatch, multiValued))),
        };
      default:
        throw new JqlError(`Operator '${c.op}' is not supported for field '${c.field}'`);
    }
  }

  // Like Jira, "field != x" does not match issues where the field is empty.
  private notMatch(
    positive: Prisma.IssueWhereInput,
    emptyMatch: Prisma.IssueWhereInput | undefined,
    multiValued: boolean,
  ): Prisma.IssueWhereInput {
    if (multiValued || !emptyMatch) return { NOT: positive };
    return { AND: [{ NOT: positive }, { NOT: emptyMatch }] };
  }

  private requireEmpty(c: ClauseNode, emptyMatch?: Prisma.IssueWhereInput) {
    if (!emptyMatch) throw new JqlError(`Field '${c.field}' cannot be EMPTY`);
    return emptyMatch;
  }

  private userField(c: ClauseNode, relation: 'assignee' | 'reporter', column: 'assigneeId' | 'reporterId') {
    return this.equality(
      c,
      (v) => (v === CURRENT_USER ? { [column]: this.ctx.currentUserId } : { [relation]: this.userMatch(v) }),
      { [column]: null },
    );
  }

  private userMatch(value: string): Prisma.UserWhereInput {
    if (value === CURRENT_USER) return { id: this.ctx.currentUserId };
    return { OR: [{ email: value }, { name: value }, { id: value }] };
  }

  private text(
    c: ClauseNode,
    match: (value: string) => Prisma.IssueWhereInput,
    emptyMatch?: Prisma.IssueWhereInput,
  ): Prisma.IssueWhereInput {
    const value = c.values[0];
    if (c.op === 'IS' || c.op === 'IS NOT') {
      if (value.kind !== 'empty') throw new JqlError(`'${c.op}' can only be used with EMPTY`);
      const empty = this.requireEmpty(c, emptyMatch);
      return c.op === 'IS' ? empty : { NOT: empty };
    }
    if (c.op !== '~' && c.op !== '!~') {
      throw new JqlError(`Use '~' (contains) or '!~' (does not contain) with text field '${c.field}'`);
    }
    // Jira treats "*" as a wildcard; a SQL LIKE with contains already matches substrings.
    const term = this.literal(c, value).replace(/\*/g, '').trim();
    if (!term) throw new JqlError(`Search text for '${c.field}' cannot be empty`);
    return c.op === '~' ? match(term) : { NOT: match(term) };
  }

  private date(c: ClauseNode, column: 'createdAt' | 'updatedAt'): Prisma.IssueWhereInput {
    const opMap: Record<string, 'gt' | 'gte' | 'lt' | 'lte'> = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
    const value = c.values[0];
    if (opMap[c.op]) return { [column]: { [opMap[c.op]]: this.dateValue(c, value) } };
    if (c.op === '=' || c.op === '!=') {
      // Whole-day match for "created = 2026-01-15".
      const start = this.dateValue(c, value);
      const end = new Date(start.getTime() + 86_400_000);
      const range = { [column]: { gte: start, lt: end } };
      return c.op === '=' ? range : { NOT: range };
    }
    throw new JqlError(`Operator '${c.op}' is not supported for date field '${c.field}'`);
  }

  private dateValue(c: ClauseNode, value: Value): Date {
    const now = this.ctx.now ?? new Date();
    if (value.kind === 'function') {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      switch (value.name) {
        case 'now':
          return now;
        case 'startofday':
          return startOfDay;
        case 'endofday':
          return new Date(startOfDay.getTime() + 86_400_000 - 1);
        case 'startofweek': {
          const d = new Date(startOfDay);
          d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          return d;
        }
        case 'startofmonth':
          return new Date(now.getFullYear(), now.getMonth(), 1);
        default:
          throw new JqlError(`Unknown date function '${value.name}()'`);
      }
    }
    if (value.kind === 'empty') throw new JqlError(`Field '${c.field}' cannot be EMPTY`);
    const raw = value.value.trim();
    // Relative offsets like -7d, -2w, -4h, -30m, 1d
    const rel = /^([+-]?\d+)([mhdw])$/i.exec(raw);
    if (rel) {
      const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2].toLowerCase() as 'm'];
      return new Date(now.getTime() + parseInt(rel[1], 10) * unitMs);
    }
    const abs = /^(\d{4})[-/](\d{2})[-/](\d{2})(?: (\d{2}):(\d{2}))?$/.exec(raw);
    if (abs) {
      const [, y, mo, d, h = '0', mi = '0'] = abs;
      // Local time, like Jira: "2026-01-15" means midnight at the start of that day.
      const date = new Date(+y, +mo - 1, +d, +h, +mi);
      if (!isNaN(date.getTime())) return date;
    }
    throw new JqlError(`'${raw}' is not a valid date. Use yyyy-MM-dd, yyyy-MM-dd HH:mm, or a relative value like -7d`);
  }

  private literal(c: ClauseNode, value: Value): string {
    if (value.kind === 'literal') return value.value;
    if (value.kind === 'function' && value.name === 'currentuser') return CURRENT_USER;
    if (value.kind === 'empty') throw new JqlError(`Use 'IS EMPTY' instead of '${c.op} EMPTY' for field '${c.field}'`);
    throw new JqlError(`Function '${value.name}()' is not supported for field '${c.field}'`);
  }
}

const CURRENT_USER = '\u0000currentUser';

export function compileJql(jql: string, ctx: JqlContext): CompiledJql {
  const { node, sort } = new Parser(tokenize(jql ?? '')).parse();
  const where = node ? new Compiler(ctx).compile(node) : {};
  return { where, orderBy: sort.length ? sort : [{ field: 'created', direction: 'desc' }] };
}
