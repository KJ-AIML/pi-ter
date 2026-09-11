import { emptyResources, plain, type Resources } from './workspace-view.ts';

// Pi 0.85.1 has no public loaded-resource API. Keep this adapter isolated and
// version guarded. Unknown layouts retain Pi's own listing and diagnostics.
type Node = { children?: Node[]; render: (width: number) => string[]; getCollapsedText?: () => string };
export class StartupResources {
  document?: Node;
  private container?: Node;
  private original?: Node['render'];
  constructor(private root: Node, private header: Node, private version: string) {}
  connect(): boolean {
    if (this.container) return true;
    if (this.version !== '0.85.1') return false;
    const visit = (node: Node): Node | undefined => {
      if (node.children?.length === 3 && node.children[0].children?.includes(this.header) && node.children[1].children && node.children[2].children) return node;
      for (const child of node.children || []) { const found = visit(child); if (found) return found; }
    };
    this.document = visit(this.root);
    if (!this.document) return false;
    this.container = this.document.children![1];
    this.original = this.container.render;
    this.container.render = width => {
      // Only recognized resource sections and their empty spacing are replaced.
      // Warning/error components and unknown future sections always survive.
      const lines = (this.container!.children || []).filter(child => !this.section(child)).flatMap(child => child.render(width));
      while (lines.length && !plain(lines[0]).trim()) lines.shift();
      while (lines.length && !plain(lines[lines.length - 1]).trim()) lines.pop();
      return lines;
    };
    return true;
  }
  private section(node: Node): { name: keyof Resources; items: string[] } | undefined {
    if (typeof node.getCollapsedText !== 'function') return;
    const text = plain(node.getCollapsedText());
    const match = /^\[(Skills|Extensions|Prompts|Context)\]\n([\s\S]*)$/.exec(text);
    if (!match) return;
    return { name: match[1] as keyof Resources, items: match[2].split(', ').map(s => s.trim()).filter(Boolean) };
  }
  snapshot(): Resources {
    this.connect();
    const result = emptyResources();
    for (const child of this.container?.children || []) {
      const section = this.section(child);
      if (section) result[section.name] = section.items;
    }
    return result;
  }
  chrome(width: number): string[] {
    if (!this.document) return [];
    const collect = (node: Node): string[] => {
      if (node === this.document) return [];
      const contains = (n: Node): boolean => n === this.document || (n.children || []).some(contains);
      return contains(node) ? (node.children || []).flatMap(collect) : node.render(width);
    };
    return collect(this.root);
  }
  remainingHeight(width: number): number {
    if (!this.document) return 8;
    const [header, resources, chat] = this.document.children!;
    return this.chrome(width).length + resources.render(width).length + chat.render(width).length + (header.children || []).filter(c => c !== this.header).flatMap(c => c.render(width)).length;
  }
  frame(width: number): string[] {
    return this.document ? [...this.document.render(width), ...this.chrome(width)] : [];
  }
  dispose(): void {
    if (this.container && this.original) this.container.render = this.original;
    this.container = undefined;
    this.document = undefined;
  }
}
