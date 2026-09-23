export interface HtmlNode {
  tag: string;
  classes: string[];
  id: string | null;
  /** Ancestor class chains by tag: e.g. Map<tag, Set<class-string>>. */
  ancestors: Array<{ tag: string; classes: string[] }>;
  text: string;
  href: string | null;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function parseAttributes(tagBody: string): { classes: string[]; id: string | null; href: string | null } {
  let classes: string[] = [];
  let id: string | null = null;
  let href: string | null = null;
  const attrPattern = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(tagBody)) !== null) {
    const name = match[1]!.toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (name === 'class') classes = value.split(/\s+/).filter((c) => c.length > 0);
    else if (name === 'id') id = value;
    else if (name === 'href') href = decodeEntities(value);
  }
  return { classes, id, href };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Extracts anchor records with ancestor class chains from HTML. This
 * supports the structural selectors the SIL importer needs
 * (`table.products div.title > a`, `a.btn-download`, `a.getfile`)
 * without a DOM dependency. */
export function extractAnchors(html: string): HtmlNode[] {
  const anchors: HtmlNode[] = [];
  const stack: Array<{ tag: string; classes: string[] }> = [];
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let lastIndex = 0;
  let pendingText = '';

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const full = match[0]!;
    const tag = match[1]!;
    const body = match[2] ?? '';
    const textChunk = html.slice(lastIndex, match.index);
    pendingText += stripTags(textChunk);
    lastIndex = match.index + full.length;
    const lowerTag = tag.toLowerCase();
    const isClosing = full.startsWith('</');

    if (isClosing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.tag === lowerTag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const selfClosing = full.endsWith('/>') || VOID_TAGS.has(lowerTag);
    const { classes, id, href } = parseAttributes(body ?? '');

    if (lowerTag === 'a') {
      anchors.push({
        tag: 'a',
        classes,
        id,
        href,
        ancestors: [...stack],
        text: '',
      });
    }

    if (!selfClosing) {
      stack.push({ tag: lowerTag, classes });
    }

    if (lowerTag === 'a') {
      // capture inner text until the matching close tag
      const closeIndex = html.toLowerCase().indexOf('</a', lastIndex);
      if (closeIndex >= 0) {
        pendingText += stripTags(html.slice(lastIndex, closeIndex));
        const anchor = anchors[anchors.length - 1]!;
        anchor.text = decodeEntities(pendingText).replace(/\s+/g, ' ').trim();
        pendingText = '';
        tagPattern.lastIndex = closeIndex;
        lastIndex = closeIndex;
        stack.pop(); // pop the <a> pushed above
      }
    }
  }
  return anchors;
}

function stripTags(chunk: string): string {
  return chunk.replace(/<[^>]*>/g, '');
}

/** Matches `tag.class` chain: the anchor's ancestors must contain, in order,
 * the given ancestor selectors; the last selector matches the anchor itself. */
export function anchorsMatchingSelector(anchors: HtmlNode[], selector: string): HtmlNode[] {
  const parts = selector
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '>')
    .map((part) => {
      const segments = part.split('.');
      const tag = segments[0] ?? '*';
      return { tag: tag.toLowerCase(), classes: segments.slice(1) };
    });
  const self = parts[parts.length - 1]!;
  const ancestors = parts.slice(0, -1);

  return anchors.filter((anchor) => {
    if (self.tag !== 'a' && self.tag !== anchor.tag) return false;
    for (const cls of self.classes) {
      if (!anchor.classes.includes(cls)) return false;
    }
    if (ancestors.length === 0) return true;

    // Walk ancestors in order; direct-child (`>`) segments were folded into
    // the selector by callers, so require adjacency for '>'-joined parts.
    let depth = anchor.ancestors.length - 1;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const wanted = ancestors[i]!;
      let found = false;
      for (; depth >= 0; depth--) {
        const candidate = anchor.ancestors[depth]!;
        const tagOk = wanted.tag === '*' || candidate.tag === wanted.tag;
        const classesOk = wanted.classes.every((c) => candidate.classes.includes(c));
        if (tagOk && classesOk) {
          found = true;
          depth -= 1;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  });
}
