import React, { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
}

interface LineInfo {
  type: 'empty' | 'heading' | 'ul' | 'ol' | 'text';
  content: string;
  level?: number;
}

/**
 * Markdown 渲染器 - 支持换行、粗体、标题、列表
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content }) => {
  const elements = useMemo(() => {
    const lines = content.split('\n');
    
    // 先解析每行的类型
    const parsed: LineInfo[] = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return { type: 'empty', content: '' };
      
      const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (hMatch) return { type: 'heading', content: hMatch[2], level: hMatch[1].length };
      
      const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (ulMatch) return { type: 'ul', content: ulMatch[1] };
      
      const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (olMatch) return { type: 'ol', content: olMatch[1] };
      
      return { type: 'text', content: line };
    });
    
    // 渲染，合并连续的列表项
    const result: React.ReactNode[] = [];
    let i = 0;
    
    while (i < parsed.length) {
      const line = parsed[i];
      
      if (line.type === 'empty') {
        result.push(<div key={i} style={{ height: '0.5em' }} />);
        i++;
      } else if (line.type === 'heading') {
        const Tag = `h${line.level}` as keyof JSX.IntrinsicElements;
        const fontSize = line.level === 1 ? 18 : line.level === 2 ? 16 : 14;
        result.push(
          <Tag key={i} style={{ margin: '12px 0 8px', fontSize, fontWeight: 600 }}>
            {renderInline(line.content)}
          </Tag>
        );
        i++;
      } else if (line.type === 'ul') {
        // 收集连续的无序列表项
        const items: string[] = [];
        while (i < parsed.length && parsed[i].type === 'ul') {
          items.push(parsed[i].content);
          i++;
        }
        result.push(
          <ul key={`ul-${i}`} style={{ paddingLeft: 20, margin: '8px 0' }}>
            {items.map((item, idx) => (
              <li key={idx} style={{ margin: '4px 0', lineHeight: 1.6 }}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      } else if (line.type === 'ol') {
        // 收集连续的有序列表项
        const items: string[] = [];
        while (i < parsed.length && parsed[i].type === 'ol') {
          items.push(parsed[i].content);
          i++;
        }
        result.push(
          <ol key={`ol-${i}`} style={{ paddingLeft: 20, margin: '8px 0' }}>
            {items.map((item, idx) => (
              <li key={idx} style={{ margin: '4px 0', lineHeight: 1.6 }}>{renderInline(item)}</li>
            ))}
          </ol>
        );
      } else {
        result.push(
          <div key={i} style={{ minHeight: '1.5em', lineHeight: 1.6 }}>
            {renderInline(line.content)}
          </div>
        );
        i++;
      }
    }
    
    return result;
  }, [content]);
  
  return <div>{elements}</div>;
});

// 行内粗体解析
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
