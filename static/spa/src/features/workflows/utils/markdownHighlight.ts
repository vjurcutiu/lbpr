type MdastNode = {
  type?: string;
  value?: string;
  children?: MdastNode[];
  data?: Record<string, unknown>;
};

function splitHighlightText(value: string): MdastNode[] | null {
  if (!value.includes("==")) return null;

  const nodes: MdastNode[] = [];
  const highlightPattern = /==([^=\n][^\n]*?[^=\n]|[^=\n])==/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = highlightPattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }

    nodes.push({
      type: "mark",
      data: { hName: "mark" },
      children: [{ type: "text", value: match[1] }],
    });

    lastIndex = match.index + match[0].length;
  }

  if (!nodes.length) return null;
  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }

  return nodes;
}

function walk(node: MdastNode) {
  if (!Array.isArray(node.children)) return;

  const nextChildren: MdastNode[] = [];

  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const split = splitHighlightText(child.value);
      if (split) {
        nextChildren.push(...split);
        continue;
      }
    }

    walk(child);
    nextChildren.push(child);
  }

  node.children = nextChildren;
}

export function remarkHighlight() {
  return (tree: MdastNode) => {
    walk(tree);
  };
}
