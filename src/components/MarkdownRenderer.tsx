import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  // Split content by code blocks to isolate code from standard markdown text
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-body" style={{ color: 'var(--text-primary)', fontSize: '14px', lineHeight: '1.6' }}>
      {parts.map((part, index) => {
        // If it's a code block
        if (part.startsWith('```')) {
          const match = part.match(/```(\w*)\n([\s\S]*?)```/);
          const lang = match ? match[1] : '';
          const code = match ? match[2] : part.slice(3, -3);

          return (
            <div key={index} className="code-block-wrapper" style={{ margin: '14px 0', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
              {lang && (
                <div className="code-block-header" style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-color)', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  {lang}
                </div>
              )}
              <pre style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.2)', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                <code>{code.trim()}</code>
              </pre>
            </div>
          );
        }

        // Standard text: process inline formatting block-by-block (split by lines)
        const lines = part.split('\n');
        return (
          <div key={index}>
            {lines.map((line, lineIdx) => {
              const cleanLine = line.trim();
              if (!cleanLine) {
                return <div key={lineIdx} style={{ height: '8px' }} />;
              }

              // Headers
              if (cleanLine.startsWith('# ')) {
                return <h1 key={lineIdx} style={{ fontSize: '20px', margin: '14px 0 8px 0', fontWeight: 600 }}>{renderInline(cleanLine.substring(2))}</h1>;
              }
              if (cleanLine.startsWith('## ')) {
                return <h2 key={lineIdx} style={{ fontSize: '18px', margin: '14px 0 8px 0', fontWeight: 600 }}>{renderInline(cleanLine.substring(3))}</h2>;
              }
              if (cleanLine.startsWith('### ')) {
                return <h3 key={lineIdx} style={{ fontSize: '16px', margin: '12px 0 6px 0', fontWeight: 600 }}>{renderInline(cleanLine.substring(4))}</h3>;
              }

              // Bullet lists
              if (cleanLine.startsWith('- ') || cleanLine.startsWith('* ')) {
                return (
                  <ul key={lineIdx} style={{ paddingLeft: '20px', margin: '4px 0' }}>
                    <li style={{ listStyleType: 'disc' }}>{renderInline(cleanLine.substring(2))}</li>
                  </ul>
                );
              }

              // Ordered lists
              const numListMatch = cleanLine.match(/^(\d+)\.\s(.*)/);
              if (numListMatch) {
                return (
                  <ol key={lineIdx} style={{ paddingLeft: '20px', margin: '4px 0' }}>
                    <li value={parseInt(numListMatch[1])}>{renderInline(numListMatch[2])}</li>
                  </ol>
                );
              }

              // Standard Paragraph
              return (
                <p key={lineIdx} style={{ margin: '6px 0' }}>
                  {renderInline(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

// Render bold (`**`) and inline code (`` ` ``) formatting
function renderInline(text: string): React.ReactNode[] {
  // Regex to extract bold blocks and inline code blocks
  // Split by bold (**text**) or inline code (`code`)
  const tokens = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return tokens.map((token, idx) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={idx} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code 
          key={idx} 
          style={{ 
            fontFamily: 'var(--font-mono)', 
            fontSize: '12px', 
            background: 'rgba(255,255,255,0.06)', 
            padding: '2px 4px', 
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            color: '#a5b4fc'
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    return token;
  });
}
export default MarkdownRenderer;
