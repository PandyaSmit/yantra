import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import s from './ui.module.css';

/** GitHub-flavoured Markdown. Raw HTML is not rendered; links open in the default browser (main allows https only). */
export function Markdown({ children, empty = 'Nothing written yet.' }: { children: string; empty?: string }) {
  if (!children.trim()) return <p className={s.markdownEmpty}>{empty}</p>;
  return (
    <div className={s.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
