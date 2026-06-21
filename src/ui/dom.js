// dom.js — the tiniest DOM helper. el('div.foo', {props}, [children]).

export function el(spec, props = {}, children = []) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'disabled' || k === 'checked' || k === 'hidden') { if (v) node.setAttribute(k, ''); else node.removeAttribute(k); node[k] = v; }
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) { if (c != null) node.append(c.nodeType ? c : document.createTextNode(c)); }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function $(sel, root = document) { return root.querySelector(sel); }
