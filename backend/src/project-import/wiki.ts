/**
 * Jira stores descriptions and comments as wiki markup ("h2. Title", "*bold*", "{code}…{code}", "!image.png!").
 * This app stores sanitised HTML, so convert the common markup and leave the rest as readable text.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(raw: string): string {
  const code: string[] = [];
  let s = raw.replace(/\{\{(.+?)\}\}/g, (_, c: string) => `\u0000${code.push(`<code>${escapeHtml(c)}</code>`) - 1}\u0000`);
  s = escapeHtml(s)
    .replace(/\\\\/g, '<br>')
    .replace(/!([^!\s|][^!\n]*?)(?:\|[^!\n]*)?!/g, (_, name: string) => `[image: ${name}]`)
    .replace(/\[~([^\]]+)\]/g, '@$1')
    .replace(/\[([^\]|]+)\|(https?:\/\/[^\]\s]+)[^\]]*\]/g, '<a href="$2">$1</a>')
    .replace(/\[(https?:\/\/[^\]\s]+)\]/g, '<a href="$1">$1</a>')
    .replace(/(^|[\s(>])(https?:\/\/[^\s<)\]]+)/g, '$1<a href="$2">$2</a>')
    .replace(/\{color[^}]*\}|\{anchor[^}]*\}/g, '')
    .replace(/(^|[\s(>])\*(\S(?:[^*\n]*?\S)?)\*(?=$|[\s).,;:!?<])/g, '$1<strong>$2</strong>')
    .replace(/(^|[\s(>])_(\S(?:[^_\n]*?\S)?)_(?=$|[\s).,;:!?<])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(>])\+(\S(?:[^+\n]*?\S)?)\+(?=$|[\s).,;:!?<])/g, '$1<u>$2</u>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => code[+n]);
}

export function wikiToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null; } };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const block = /^\{(code|noformat)(?::[^}]*)?\}(.*)$/.exec(line.trim());
    if (block) {
      flush();
      const body: string[] = [];
      let rest = block[2];
      for (; ; i++) {
        const end = rest.indexOf(`{${block[1]}}`);
        if (end >= 0) { body.push(rest.slice(0, end)); break; }
        body.push(rest);
        if (i + 1 >= lines.length) break;
        rest = lines[i + 1];
      }
      out.push(`<pre><code>${escapeHtml(body.join('\n').replace(/^\n|\n$/g, ''))}</code></pre>`);
      continue;
    }
    if (/^\{quote\}/.test(line.trim())) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\{quote\}/.test(lines[i].trim()); i++) body.push(lines[i]);
      out.push(`<blockquote><p>${body.map(inline).join('<br>')}</p></blockquote>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = /^h([1-6])\.\s+(.*)$/.exec(line);
    if (heading) { flush(); out.push(`<h${Math.min(+heading[1], 3)}>${inline(heading[2])}</h${Math.min(+heading[1], 3)}>`); continue; }
    if (/^-{4,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const item = /^\s*([*#]+|-)\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const tag = item[1].startsWith('#') ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      (list ??= { tag, items: [] }).items.push(inline(item[2]));
      continue;
    }
    flushList();
    // Tables stay readable as rows of cells.
    para.push(inline(/^\|/.test(line) ? line.replace(/\|\|/g, '|').replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join(' | ') : line));
  }
  flush();
  return out.join('') || '<p></p>';
}
