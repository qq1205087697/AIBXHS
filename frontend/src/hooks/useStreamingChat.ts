import { useState, useCallback, useRef } from 'react';

/**
 * 聊天消息接口
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

/**
 * 流式聊天 Hook 配置选项
 */
export interface UseStreamingChatOptions {
  /** 错误回调函数 */
  onError?: (error: string) => void;
  /** 完成回调函数 */
  onComplete?: (sessionId: string) => void;
}

/**
 * 流式聊天 Hook 返回值
 */
export interface UseStreamingChatReturn {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 是否正在流式生成 */
  isStreaming: boolean;
  /** 当前流式生成的内容 */
  streamingContent: string;
  /** 发送消息 */
  sendMessage: (message: string, sessionId?: string, chatType?: string) => Promise<void>;
  /** 停止生成 */
  stopStreaming: () => void;
  /** 清空消息 */
  clearMessages: () => void;
  /** 设置消息列表（用于加载历史消息） */
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

/**
 * SSE 数据块类型
 */
interface SSEData {
  type: 'content' | 'thinking' | 'done' | 'error' | 'start';
  content?: string;
  session_id?: string;
  error?: string;
}

/**
 * 流式聊天 Hook
 *
 * 性能优化：
 * - 使用 requestAnimationFrame 节流渲染，避免每个字符都触发重渲染
 * - 流式期间降低渲染频率（~60ms 一次），大幅减少 MarkdownRenderer 解析开销
 */
export function useStreamingChat(options: UseStreamingChatOptions = {}): UseStreamingChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // 用于节流的 ref：存储最新内容，由 rAF 批量更新到 state
  const pendingContentRef = useRef('');
  const rafIdRef = useRef<number | null>(null);

  /**
   * 停止流式生成
   */
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 取消待处理的 rAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setIsStreaming(false);
    setStreamingContent('');
    pendingContentRef.current = '';
  }, []);

  /**
   * 发送消息并处理流式响应
   */
  const sendMessage = useCallback(async (
    message: string,
    sessionId?: string,
    chatType: string = 'review'
  ): Promise<void> => {
    if (!message.trim() || isStreaming) return;

    // 添加用户消息
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent('');
    pendingContentRef.current = '';

    // 创建 AbortController 用于取消请求
    abortControllerRef.current = new AbortController();

    // 节流更新函数：用 rAF 合并多次 setState
    const scheduleContentUpdate = (newContent: string) => {
      pendingContentRef.current = newContent;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          setStreamingContent(pendingContentRef.current);
          rafIdRef.current = null;
        });
      }
    };

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({
          message,
          session_id: sessionId,
          chat_type: chatType
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let currentSessionId = sessionId || '';

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      // 读取流式数据
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data: SSEData = JSON.parse(line.slice(6));

              switch (data.type) {
                case 'content':
                  if (data.content) {
                    fullContent += data.content;
                    // 使用节流更新，而非每次都 setState
                    scheduleContentUpdate(fullContent);
                  }
                  break;
                case 'thinking':
                  break;
                case 'done':
                  currentSessionId = data.session_id || currentSessionId;
                  break;
                case 'error':
                  throw new Error(data.error || '未知错误');
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      // 流结束，确保最终内容同步到 state
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setStreamingContent(fullContent);

      // 添加 AI 回复到消息列表
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: fullContent,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMessage]);
      setStreamingContent('');

      // 调用完成回调
      options.onComplete?.(currentSessionId);

    } catch (error: any) {
      // 取消待处理的 rAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (error.name !== 'AbortError') {
        const errorMsg = error.message || '发送消息失败';
        options.onError?.(errorMsg);

        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `❌ ${errorMsg}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
      pendingContentRef.current = '';
    }
  }, [isStreaming, options]);

  /**
   * 清空所有消息
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamingContent('');
    setIsStreaming(false);
    pendingContentRef.current = '';
  }, []);

  return {
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
    stopStreaming,
    clearMessages,
    setMessages
  };
}

export default useStreamingChat;
