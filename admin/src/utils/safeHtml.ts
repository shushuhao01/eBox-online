// 富文本安全渲染：管理端预览统一走这里，防止存储型 XSS。
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
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i

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

/** 清洗富文本 HTML，返回可安全用于 v-html 的字符串 */
export function renderSafeHtml(html: string | null | undefined): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(String(html), 'text/html')
  for (const child of Array.from(doc.body.children)) {
    sanitizeElement(child)
  }
  return doc.body.innerHTML
}
