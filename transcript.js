const { AttachmentBuilder } = require('discord.js');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Discord-style markdown. Input is escaped first, so user text can never inject HTML.
function md(raw) {
  const blocks = [];
  let s = esc(raw).replace(/```(?:\w+\n)?([\s\S]*?)```/g, (_, c) => { blocks.push(`<pre>${c.replace(/\n$/, '')}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { blocks.push(`<code>${c}</code>`); return `\u0000${blocks.length - 1}\u0000`; })
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, k) => blocks[k]);
}

const fmt = d => d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const MAX_IMG = 3 * 1024 * 1024;   // per image
const BUDGET = 5 * 1024 * 1024;    // total per transcript, keeps the file under Discord's upload limit

// Discord attachment links expire after ~24h, so small images are embedded in the file itself.
async function inlineImages(messages) {
  const map = new Map();
  let used = 0;
  for (const m of messages) for (const a of m.attachments.values()) {
    if (!isImg(a) || (a.size && a.size > MAX_IMG)) continue;
    try {
      const res = await fetch(a.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMG || used + buf.length > BUDGET) continue;
      used += buf.length;
      map.set(a.id ?? a.url, `data:${a.contentType || 'image/png'};base64,${buf.toString('base64')}`);
    } catch { /* fall back to the original link */ }
  }
  return map;
}

const isImg = a => (a.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || '');

function renderEmbed(e) {
  const color = e.hexColor || '#4f545c';
  return `<div class="embed" style="border-left-color:${esc(color)}">` +
    (e.author?.name ? `<div class="e-author">${esc(e.author.name)}</div>` : '') +
    (e.title ? `<div class="e-title">${esc(e.title)}</div>` : '') +
    (e.description ? `<div class="e-desc">${md(e.description)}</div>` : '') +
    (e.fields?.length ? `<div class="e-fields">${e.fields.map(f =>
      `<div class="e-field"><b>${esc(f.name)}</b><div>${md(f.value)}</div></div>`).join('')}</div>` : '') +
    (e.footer?.text ? `<div class="e-footer">${esc(e.footer.text)}</div>` : '') + `</div>`;
}

function renderMessage(m, grouped, inline = new Map()) {
  const name = m.member?.displayName ?? m.author.displayName ?? m.author.username;
  const hex = m.member?.displayHexColor;
  const color = hex && hex !== '#000000' ? hex : '#f2f3f5';
  const body =
    (m.cleanContent ? `<div class="content">${md(m.cleanContent)}</div>` : '') +
    [...m.attachments.values()].map(a => isImg(a)
      ? (inline.has(a.id ?? a.url)
          ? `<img class="att" src="${inline.get(a.id ?? a.url)}" alt="${esc(a.name)}">`
          : `<a href="${esc(a.url)}" target="_blank"><img class="att" src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>`)
      : `<a class="file" href="${esc(a.url)}" target="_blank">📎 ${esc(a.name)}</a>`).join('') +
    m.embeds.map(renderEmbed).join('');

  if (grouped) return `<div class="msg grouped" id="m-${m.id}"><span class="ts-side">${fmt(m.createdAt).slice(11, 16)}</span><div class="body">${body}</div></div>`;
  return `<div class="msg" id="m-${m.id}">
  <img class="avatar" src="${esc(m.author.displayAvatarURL({ extension: 'png', size: 64 }))}" alt="">
  <div class="body"><div class="head"><span class="name" style="color:${esc(color)}">${esc(name)}</span>${m.author.bot ? '<span class="bot">APP</span>' : ''}<span class="ts">${fmt(m.createdAt)}</span></div>${body}</div></div>`;
}

const CSS = `*{box-sizing:border-box}body{margin:0;background:#313338;color:#dbdee1;font:15px/1.45 "gg sans","Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:16px}.top{background:#2b2d31;border-radius:8px;padding:16px 20px;margin-bottom:16px}
.top h1{margin:0 0 4px;font-size:20px;color:#fff}.top p{margin:2px 0;color:#949ba4;font-size:13px}
.msg{display:flex;gap:14px;padding:4px 8px;margin-top:14px;border-radius:4px}.msg:hover{background:#2e3035}
.msg.grouped{margin-top:0;padding-left:8px}.ts-side{width:40px;flex:none;text-align:right;font-size:11px;color:#949ba4;opacity:0;padding-top:3px}.msg.grouped:hover .ts-side{opacity:1}
.avatar{width:40px;height:40px;border-radius:50%;flex:none}.body{min-width:0;flex:1}.head{display:flex;align-items:center;gap:8px}
.name{font-weight:600}.bot{background:#5865f2;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;font-weight:600}.ts{color:#949ba4;font-size:12px}
.content{word-wrap:break-word;overflow-wrap:anywhere}.content a,.e-desc a{color:#00a8fc}
code{background:#1e1f22;padding:1px 5px;border-radius:3px;font-size:13px}pre{background:#1e1f22;border:1px solid #232428;border-radius:4px;padding:8px 10px;overflow-x:auto;margin:4px 0;font-size:13px}
.att{display:block;max-width:400px;max-height:300px;border-radius:6px;margin-top:6px}.file{display:inline-block;margin-top:6px;color:#00a8fc;background:#2b2d31;padding:8px 12px;border-radius:6px;text-decoration:none}
.embed{background:#2b2d31;border-left:4px solid #4f545c;border-radius:4px;padding:8px 14px 10px;margin-top:6px;max-width:520px}
.e-title{font-weight:600;color:#fff;margin-bottom:4px}.e-author{font-size:13px;font-weight:600;margin-bottom:4px}.e-desc{font-size:14px}
.e-fields{display:grid;gap:8px;margin-top:8px}.e-field{font-size:14px}.e-field b{display:block;font-size:13px}.e-footer{font-size:12px;color:#949ba4;margin-top:8px}
.end{text-align:center;color:#949ba4;font-size:12px;margin:24px 0 8px}`;

async function buildTranscript(channel, ticket) {
  const all = [];
  let lastId;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(lastId && { before: lastId }) });
    if (!batch.size) break;
    all.push(...batch.values());
    lastId = batch.last().id;
  }
  all.reverse();
  const inline = await inlineImages(all);

  let prev = null;
  const rows = all.map(m => {
    const grouped = prev && prev.author.id === m.author.id && m.createdTimestamp - prev.createdTimestamp < 7 * 60e3;
    prev = m;
    return renderMessage(m, grouped, inline);
  }).join('\n');

  const people = [...new Set(all.map(m => m.author.tag ?? m.author.username))];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transcript ${esc(channel.name)}</title><style>${CSS}</style></head><body><div class="wrap">
<div class="top"><h1>#${esc(channel.name)}${ticket ? ` · Ticket #${String(ticket.id).padStart(4, '0')}` : ''}</h1>
<p>${esc(channel.guild?.name ?? '')}</p><p>${all.length} messages · ${people.length} participants: ${esc(people.join(', '))}</p>
<p>Exported ${fmt(new Date())}</p></div>
${rows || '<p>No messages.</p>'}
<div class="end">End of transcript</div></div></body></html>`;

  return new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `${channel.name}.html` });
}

module.exports = { buildTranscript, md };
