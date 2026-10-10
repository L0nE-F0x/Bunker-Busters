// Collects every voiced line in the game, by speaker, from the source itself.
//
//   node scripts/voice/extract.mjs          → scripts/voice/lines.json + src/content/voiceClips.json
//
// A line is found wherever text meets a speaker: an object literal with `speaker` + `text`, a
// `subtitle(speaker, text)` or `pivotNode(speaker, text)` call, a `taunts` array beside a `name`,
// BARKS (every crew voice), SENTRY_LINES, Dez's RUMOURS, Inez's TILL_LINES, each archetype's
// `briefing` and `coda` (Mara), a bunker owner's `line` / `greet` / `alarm`, and Settlement's
// `news()` (one case per townsperson). Text built at runtime is reduced to the literal pieces it's
// made from (following local consts, `x += ...` in the same function, and lookups into object
// literals like `lines[stage(v)]`); each piece keeps only its complete sentences, so
// `${name}. Water, then names.` still voices "Water, then names."
// The game cuts what it shows into sentences the same way (src/content/voices.ts) and plays the clips it has.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { transformSync } from 'rolldown/experimental';

const root = fileURLToPath(new URL('../..', import.meta.url));
const load = async (rel) => {
  const { code } = transformSync(rel, fs.readFileSync(path.join(root, rel), 'utf8'), { lang: 'ts' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
const V = await load('src/content/voices.ts');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('voices.ts')) files.push(p);
  }
})(path.join(root, 'src'));

const units = new Map(); // key → unit
const silent = new Map(); // speaker → count (for the report)

// ESTree walking with parent links
const kids = (n) => {
  const out = [];
  for (const k in n) {
    if (k === 'parent') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') out.push(x); }
    else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
};
const link = (n, parent = null) => { n.parent = parent; for (const c of kids(n)) link(c, n); };
const isStr = (n) => (n.type === 'Literal' && typeof n.value === 'string') || (n.type === 'TemplateLiteral' && n.expressions.length === 0);
const strOf = (n) => (n.type === 'Literal' ? n.value : n.quasis[0].value.cooked);
const keyName = (p) => p.key?.name ?? p.key?.value;
const unwrap = (n) => (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'ParenthesizedExpression' || n.type === 'TSNonNullExpression') ? unwrap(n.expression) : n);

/** Literal value of an expression, following local consts. */
function str(e, seen = new Set()) {
  e = unwrap(e);
  if (!e) return null;
  if (isStr(e)) return strOf(e);
  if (e.type === 'Identifier') { const d = decl(e, seen); return d ? str(d, seen) : null; }
  return null;
}

/** The value a member expression reads, when it's a lookup into an object literal in this file (computed: the whole object). */
function member(m) {
  const obj = unwrap(m.object);
  let base = null;
  if (obj.type === 'Identifier') { const d = decl(obj, new Set()); base = d ? unwrap(d) : null; }
  else if (obj.type === 'MemberExpression') base = member(obj);
  if (!base || base.type !== 'ObjectExpression') return null;
  if (m.computed) return base;
  const p = base.properties.find((q) => q.type === 'Property' && keyName(q) === m.property.name);
  return p ? p.value : null;
}

/** Right-hand sides of `name = ...` / `name += ...` in the function around an identifier. */
function assigns(id) {
  let fn = id.parent;
  while (fn && !/Function/.test(fn.type)) fn = fn.parent;
  const out = [];
  const walk = (n) => {
    if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && n.left.name === id.name) out.push(n.right);
    for (const c of kids(n)) walk(c);
  };
  if (fn) walk(fn.body);
  return out;
}

/** Initializer of the const/let an identifier names, searched outward from it. */
function decl(id, seen) {
  if (seen.has(id.name)) return null;
  seen.add(id.name);
  for (let n = id.parent; n; n = n.parent) {
    if (!Array.isArray(n.body)) continue;
    for (let s of n.body) {
      if (s.type === 'ExportNamedDeclaration' && s.declaration) s = s.declaration;
      if (s.type !== 'VariableDeclaration') continue;
      for (const d of s.declarations) if (d.id.type === 'Identifier' && d.id.name === id.name && d.init) return d.init;
    }
  }
  return null;
}

/** Every literal piece of text inside an expression (branches, templates, local consts, arrow bodies). */
function pieces(e, out = [], seen = new Set()) {
  const visit = (n) => {
    if (!n) return;
    if (isStr(n)) { out.push({ text: strOf(n), head: true }); return; }
    if (n.type === 'TemplateLiteral') {
      n.quasis.forEach((q, i) => {
        out.push({ text: q.value.cooked ?? q.value.raw, head: i === 0 });
        if (i < n.expressions.length) visit(n.expressions[i]);
      });
      return;
    }
    if (n.type === 'Identifier') {
      const p = n.parent;
      if (p && p.type === 'MemberExpression' && p.property === n) return;
      if (seen.has(n.name)) return;
      const d = decl(n, seen);
      if (d) visit(d);
      for (const rhs of assigns(n)) visit(rhs);
      return;
    }
    if (n.type === 'Property') { visit(n.value); return; }
    if (n.type === 'CallExpression') {
      // flags and lookups (s.has('x'), rep('nia')) aren't speech; their callbacks might be
      for (const a of n.arguments) if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression') visit(a);
      return;
    }
    if (n.type === 'BinaryExpression' && /[=<>]/.test(n.operator)) return;
    if (n.type === 'MemberExpression') { const v = member(n); if (v) visit(v); return; }
    for (const c of kids(n)) visit(c);
  };
  visit(e);
  return out;
}

const TERMINAL = /[.!?…—-]$/;
/** The complete sentences of one literal piece. A piece that opens mid-sentence loses its first, one that trails into a placeholder loses its last. */
function whole(piece) {
  const raw = piece.text;
  let ss = V.sentences(V.spoken(raw));
  if (!ss.length) return null;
  const lead = raw.replace(/^[\s"“(]+/, '');
  if (!piece.head || /^[a-z,;:]/.test(lead)) { if (!/^[A-Z0-9'.…]/.test(lead) || /^[a-z]/.test(lead)) ss = ss.slice(1); }
  if (ss.length && !TERMINAL.test(ss[ss.length - 1])) ss = ss.slice(0, -1);
  return ss.length ? ss : null;
}

/** What Kokoro reads: shouted words in normal case (it spells long capitals out), brand marks dropped. */
const ACRONYMS = new Set(['SLA', 'EMP', 'CEO', 'AI', 'OK', 'HR', 'PR', 'VIP', 'GPS', 'NDA', 'IPO', 'B2B', 'SaaS', 'UI', 'CVR', 'ID', 'II', 'III']);
function forTts(words) {
  return words
    .replace(/[™®]/g, '')
    .replace(/\bSeedBot\b/g, 'Seed Bot')
    .replace(/\bBunkrly\b/g, 'Bunker dot lee')
    .replace(/\b[A-Z][A-Z']{1,}\b/g, (w) => (ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .replace(/_/g, ' ');
}

function emit(speaker, piecesList, where) {
  const c = V.castFor(speaker);
  if (!c) { silent.set(speaker, (silent.get(speaker) ?? 0) + 1); return; }
  const voices = Array.isArray(c.voice) ? c.voice : [c.voice];
  for (const p of piecesList) {
    const ss = whole(p);
    if (!ss) continue;
    const words = ss.join(' ');
    for (const voice of voices) {
      const key = V.clipKey(voice, words);
      if (!units.has(key)) units.set(key, { key, voice, fx: c.fx, speed: c.speed ?? 1, speaker: speaker.split(' · ')[0], words, tts: forTts(words), where });
    }
  }
}

/** Settlement.news(): `case 'nia': return pick([when, ' line'], ...)`. */
const TOWN = { nia: 'Nia Pell', doc: 'Doc Ivers', inez: 'Inez Quill', sol: 'Sol Varga', ren: 'Ren Oka', wick: 'Wick' };

for (const f of files) {
  const rel = path.relative(root, f);
  const ast = parseAst(fs.readFileSync(f, 'utf8'), { lang: 'ts' }, f);
  link(ast);
  // a bunker's owner speaks its `line`, `greet` and `alarm` entries
  let owner = null;
  if (rel.includes('content/bunkers/')) {
    const find = (n) => {
      if (owner) return;
      if (n.type === 'Property' && keyName(n) === 'owner' && unwrap(n.value).type === 'ObjectExpression') {
        const nm = unwrap(n.value).properties.find((p) => p.type === 'Property' && keyName(p) === 'name');
        if (nm) owner = str(nm.value);
      }
      for (const c of kids(n)) find(c);
    };
    find(ast);
  }
  const visit = (n) => {
    if (owner && n.type === 'Property' && ['line', 'greet', 'alarm'].includes(keyName(n))) emit(owner, pieces(n.value), rel);
    if (rel.endsWith('archetypes.ts') && n.type === 'ObjectExpression') {
      for (const p of n.properties) if (p.type === 'Property' && (keyName(p) === 'briefing' || keyName(p) === 'coda')) emit('Mara Voss', pieces(p.value), rel);
    }
    if (n.type === 'MethodDefinition' && keyName(n) === 'news') {
      const cases = (m) => {
        if (m.type === 'SwitchCase' && m.test && isStr(m.test) && TOWN[strOf(m.test)]) {
          const lines = [];
          const grab = (k) => {
            if (k.type === 'ArrayExpression' && k.elements.length === 2 && k.elements[1] && isStr(k.elements[1])) lines.push({ text: strOf(k.elements[1]), head: true });
            for (const c of kids(k)) grab(c);
          };
          m.consequent.forEach(grab);
          emit(TOWN[strOf(m.test)], lines, rel);
        }
        for (const c of kids(m)) cases(c);
      };
      cases(n);
    }
    if (n.type === 'ObjectExpression') {
      const prop = (k) => n.properties.find((p) => p.type === 'Property' && keyName(p) === k);
      const sp = prop('speaker'), tx = prop('text');
      if (sp && tx) {
        const who = str(sp.value);
        if (who) emit(who, pieces(tx.value), rel);
      }
      const taunts = prop('taunts'), name = prop('name');
      if (taunts && name && str(name.value) && unwrap(taunts.value).type === 'ArrayExpression') emit(str(name.value), pieces(taunts.value), rel);
    }
    if (n.type === 'CallExpression' && n.arguments.length >= 2) {
      const c = n.callee;
      const nm = c.type === 'MemberExpression' ? c.property.name : c.type === 'Identifier' ? c.name : '';
      if (nm === 'subtitle' || nm === 'pivotNode') { const who = str(n.arguments[0]); if (who) emit(who, pieces(n.arguments[1]), rel); }
    }
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) {
      if (n.id.name === 'BARKS') emit('Kade Recovery', pieces(n.init), rel);
      if (n.id.name === 'SENTRY_LINES') emit('Compliance Sentry', pieces(n.init), rel);
      if (n.id.name === 'TILL_LINES') emit('Inez Quill', pieces(n.init), rel);
      if (n.id.name === 'RUMOURS' && unwrap(n.init).type === 'ArrayExpression') {
        for (const r of unwrap(n.init).elements) {
          const t = r?.type === 'ObjectExpression' && r.properties.find((p) => p.type === 'Property' && keyName(p) === 'text');
          if (t) emit('Dez Marlow', pieces(t.value), rel);
        }
      }
    }
    for (const c of kids(n)) visit(c);
  };
  visit(ast);
}

// Mara greets you by name before anything else: give her each character's name as its own clip.
const arch = fs.readFileSync(path.join(root, 'src/content/archetypes.ts'), 'utf8');
for (const [, name] of arch.matchAll(/^    name: '([^']+)',$/gm)) emit('Mara Voss', [{ text: `${name}.`, head: true }], 'archetypes');

const list = [...units.values()].sort((a, b) => a.speaker.localeCompare(b.speaker) || a.words.localeCompare(b.words));
fs.writeFileSync(path.join(root, 'scripts/voice/lines.json'), JSON.stringify(list, null, 1));
fs.writeFileSync(path.join(root, 'src/content/voiceClips.json'), JSON.stringify(list.map((u) => u.key).sort()));
const by = {};
for (const u of list) by[u.speaker] = (by[u.speaker] ?? 0) + 1;
console.log(`${list.length} clips, ${list.reduce((n, u) => n + u.words.length, 0)} characters`);
console.log(Object.entries(by).map(([k, v]) => `  ${k}: ${v}`).join('\n'));
console.log('silent speakers:', [...silent.keys()].join(', '));
