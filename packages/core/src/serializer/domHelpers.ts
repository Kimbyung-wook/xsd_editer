export const XSD_NAMESPACE = "http://www.w3.org/2001/XMLSchema";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export function childElements(node: Node): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child.nodeType === ELEMENT_NODE) result.push(child as Element);
  }
  return result;
}

export function isXsd(el: Element, localName: string): boolean {
  return el.namespaceURI === XSD_NAMESPACE && el.localName === localName;
}

/** Resolves a childNodes-index path (see model/types.ts SourceRef) back to the DOM node it points at. */
export function resolvePath(doc: Document, path: number[]): Node | null {
  let node: Node = doc;
  for (const index of path) {
    const child: ChildNode | undefined = node.childNodes[index];
    if (!child) return null;
    node = child;
  }
  return node;
}

export function setOrRemoveAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, value);
  }
}

export function setOrRemoveBoolAttr(el: Element, name: string, value: boolean): void {
  if (value) {
    el.setAttribute(name, "true");
  } else {
    el.removeAttribute(name);
  }
}

/** Guesses the container's indentation from its own leading whitespace text node, defaulting to two spaces. */
function detectIndentUnit(containerEl: Element): string {
  const first = containerEl.previousSibling;
  if (first && first.nodeType === TEXT_NODE) {
    const match = /\n([ \t]*)$/.exec(first.textContent ?? "");
    if (match) return match[1] || "  ";
  }
  return "  ";
}

/**
 * Replaces all direct children of `containerEl` whose localName is in `managedLocalNames` (plus
 * the whitespace-only text nodes immediately surrounding them) with `newChildren`, each on its
 * own indented line. Children not in `managedLocalNames` (e.g. `xs:annotation`, which this
 * editor doesn't yet let the user rewrite) are left exactly where they are.
 */
export function replaceManagedChildren(
  doc: Document,
  containerEl: Element,
  managedLocalNames: ReadonlySet<string>,
  newChildren: Element[]
): void {
  const nodesToRemove: ChildNode[] = [];
  for (let i = 0; i < containerEl.childNodes.length; i += 1) {
    const node = containerEl.childNodes[i];
    if (node.nodeType === ELEMENT_NODE && managedLocalNames.has((node as Element).localName)) {
      nodesToRemove.push(node);
      const prev = node.previousSibling;
      if (prev && prev.nodeType === TEXT_NODE && (prev.textContent ?? "").trim() === "") {
        nodesToRemove.push(prev);
      }
    }
  }
  for (const node of nodesToRemove) {
    containerEl.removeChild(node);
  }

  const indent = detectIndentUnit(containerEl);
  const childIndent = `${indent}  `;
  for (const child of newChildren) {
    containerEl.appendChild(doc.createTextNode(`\n${childIndent}`));
    containerEl.appendChild(child);
  }
  if (newChildren.length > 0) {
    containerEl.appendChild(doc.createTextNode(`\n${indent}`));
  }
}
