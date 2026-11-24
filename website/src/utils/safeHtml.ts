// 富文本安全渲染：官网内容统一走这里，防止存储型 XSS。
// 白名单标签 + 属性白名单 + 禁止 on* 事件属性 + 禁止 javascript: 协议。

const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'p', 'br', 'div', 'span',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
  'code', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'hr',
  'font', 'sub', 'sup', 'figure', 'figcaption',
])

const GLOBAL_ATTRS = new Set(['class', 'style', 'title'])
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
}

const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'])
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/|data:image\/)/i

// 链接只允许常规协议 / 站内路径，阻断 javascript:、vbscript: 等可执行协议
const SAFE_LINK = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i

/** 校验动态链接（后台配置 / 接口返回），非法或空值返回空串 */
export function safeUrl(url: string | null | undefined): string {
  if (!url) return ''
  const value = String(url).trim()
  return SAFE_LINK.test(value) ? value : ''
}

function sanitizeElement(el: Element): void {
  const tag = el.tagName.toLowerCase()
  if (!ALLOWED_TAGS.has(tag)) {
    if (DROP_TAGS.has(tag)) {
      el.remove()
      return
    }
    // 未知标签去掉标签本身，保留文本内容
    const text = el.ownerDocument.createTextNode(el.textContent || '')
    el.replaceWith(text)
    return
  }
  const tagAttrs = TAG_ATTRS[tag]
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    const allowed = GLOBAL_ATTRS.has(name) || (tagAttrs ? tagAttrs.has(name) : false)
    if (!allowed || name.startsWith('on')) {
      el.removeAttribute(attr.name)
      continue
    }
    if ((name === 'href' || name === 'src') && !SAFE_URL.test(attr.value.trim())) {
      el.removeAttribute(attr.name)
    }
  }
  for (const child of Array.from(el.children)) {
    sanitizeElement(child)
  }
}

/**
 * 构建期（SSG / SSR）没有 DOMParser，用保守的字符串清洗兜底：
 * 保证预渲染 HTML 里保留正文（利于 SEO），危险标签 / 事件属性 / 可执行协议一律剔除；
 * 客户端水合后仍会走下面的 DOM 白名单清洗。
 */
function sanitizeHtmlString(html: string): string {
  return html
    // 整段删除可执行 / 可嵌入标签（含内容）
    .replace(/<(script|style|iframe|object|embed|form|svg|math|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    // 删除未闭合的同类标签与元信息标签
    .replace(/<\/?(?:script|style|iframe|object|embed|form|svg|math|link|meta|base|template)\b[^>]*>/gi, '')
    // 事件属性
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // javascript: / vbscript: / data:text/html 协议
    .replace(/\s+(?:href|src)\s*=\s*(?:"|')?\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"'\s>]*(?:"|')?/gi, '')
}

/** 清洗富文本 HTML，返回可安全用于 v-html 的字符串 */
export function renderSafeHtml(html: string | null | undefined): string {
  if (!html) return ''
  // 构建期（SSG / SSR）没有 DOM：用字符串清洗保留正文，客户端水合后再做 DOM 白名单清洗
  if (typeof DOMParser === 'undefined') return sanitizeHtmlString(String(html))
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  for (const child of Array.from(doc.body.children)) {
    sanitizeElement(child)
  }
  return doc.body.innerHTML
}
