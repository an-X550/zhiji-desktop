import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** Render model text as CommonMark/GFM without executing model-provided HTML. */
export function MarkdownDocument({ children }: { children: string }) {
  return <div className="markdown-document"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: ({ children: tableChildren }) => <div className="markdown-table-wrap"><table>{tableChildren}</table></div> }}>{stripFrontmatter(children)}</ReactMarkdown></div>;
}
