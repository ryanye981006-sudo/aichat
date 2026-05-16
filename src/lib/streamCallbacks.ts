// SSE 流式回调工厂 — 消除 handleSendMessage 和 handleRegenerate 之间 ~150 行重复逻辑

import type { Message } from '../types';

interface MutableState {
  fullRawContent: string;
  currentReasoning: string;
  reasoningSegments: any[];
}

interface StreamContext {
  messagesCacheRef: React.MutableRefObject<Record<string, Message[]>>;
  currentConversationIdRef: React.MutableRefObject<string | null>;
  abortControllersRef: React.MutableRefObject<Record<string, AbortController>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamingConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  setAbortController: React.Dispatch<React.SetStateAction<AbortController | null>>;
}

export function createStreamCallbacks(
  targetMessageId: string,
  activeConvRef: { current: string },
  state: MutableState,
  ctx: StreamContext,
  options?: {
    enableGhostFilter?: boolean;
    onAfterDone?: () => void;
  },
) {
  const { messagesCacheRef, currentConversationIdRef } = ctx;
  const conv = () => activeConvRef.current;

  function applyUpdate(updater: (m: Message) => Message) {
    const cached = messagesCacheRef.current[conv()];
    if (cached) {
      messagesCacheRef.current[conv()] = cached.map(m =>
        m.id === targetMessageId ? updater(m) : m
      );
    }
    if (conv() !== currentConversationIdRef.current) return;
    ctx.setMessages(prev => prev.map(m =>
      m.id === targetMessageId ? updater(m) : m
    ));
  }

  return {
    onMeta(_convId: string) {},

    onToken(token: string) {
      state.fullRawContent += token;
      applyUpdate(m => ({
        ...m, raw_content: state.fullRawContent, content: state.fullRawContent, aborted: false,
      }));
    },

    onParsed(thoughtProcess: string, displayContent: string) {
      applyUpdate(m => ({
        ...m, thought_process: thoughtProcess, content: displayContent, aborted: false,
      }));
    },

    onReasoning(token: string) {
      state.currentReasoning += token;
      const liveSegments = [...state.reasoningSegments, { type: 'reasoning', text: state.currentReasoning }];
      applyUpdate(m => ({
        ...m, thought_process: state.currentReasoning, reasoningSegments: liveSegments,
      }));
    },

    onDone(messageId: string, content: string, thoughtProcess: string, metrics: any, aborted: boolean) {
      if (state.currentReasoning) {
        state.reasoningSegments.push({ type: 'reasoning', text: state.currentReasoning });
      }
      const finalSegments = [...state.reasoningSegments];

      const finalizeMessage = (prev: Message[]) => prev.map(m =>
        m.id === targetMessageId
          ? { ...m, id: messageId, content, thought_process: thoughtProcess, metrics: metrics || null, aborted: aborted || false, isStreaming: false, reasoningSegments: finalSegments }
          : m
      );

      const isCurrentConv = conv() === currentConversationIdRef.current;
      if (isCurrentConv) {
        ctx.setMessages(finalizeMessage);
        ctx.setIsStreaming(false);
        ctx.setStreamingConversationId(null);
        ctx.setAbortController(null);
        delete ctx.abortControllersRef.current[conv()];
        delete messagesCacheRef.current[conv()];
        options?.onAfterDone?.();
      } else {
        const cached = messagesCacheRef.current[conv()];
        if (cached) {
          messagesCacheRef.current[conv()] = finalizeMessage(cached);
        }
      }
    },

    onToolCall(toolCallId: string, toolName: string, args: any) {
      if (state.currentReasoning) {
        state.reasoningSegments.push({ type: 'reasoning', text: state.currentReasoning });
        state.currentReasoning = '';
      }
      const tcEntry = { toolCallId, toolName, args, status: 'running' as const };
      state.reasoningSegments.push({ type: 'tool_call', toolCall: tcEntry });

      applyUpdate(m => ({
        ...m, toolCalls: [...(m.toolCalls || []), tcEntry], reasoningSegments: [...state.reasoningSegments],
      }));
    },

    onToolResult(toolCallId: string, toolName: string, result: any) {
      state.reasoningSegments = state.reasoningSegments.map(seg =>
        seg.type === 'tool_call' && seg.toolCall.toolCallId === toolCallId
          ? { ...seg, toolCall: { ...seg.toolCall, result, status: 'done' as const } }
          : seg
      );
      if (options?.enableGhostFilter) {
        state.reasoningSegments = state.reasoningSegments.filter(seg =>
          !(seg.type === 'tool_call' && seg.toolCall.toolName === toolName && seg.toolCall.status === 'running' && !seg.toolCall.result)
        );
      }
      const segs = [...state.reasoningSegments];

      applyUpdate(m => ({
        ...m,
        toolCalls: (m.toolCalls || [])
          .filter(tc => !(options?.enableGhostFilter && tc.toolName === toolName && tc.status === 'running' && !tc.result))
          .map(tc => tc.toolCallId === toolCallId ? { ...tc, result, status: 'done' as const } : tc),
        reasoningSegments: segs,
      }));
    },

    onStepStart(_step: number) {
      if (state.currentReasoning) {
        state.reasoningSegments.push({ type: 'reasoning', text: state.currentReasoning });
        state.currentReasoning = '';
      }
      state.fullRawContent = '';
      applyUpdate(m => ({
        ...m, raw_content: '', content: '', thought_process: null,
      }));
    },

    onError(error: string) {
      const finalizeError = (prev: Message[]) => prev.map(m =>
        m.id === targetMessageId
          ? { ...m, content: `错误: ${error}`, isStreaming: false }
          : m
      );

      const isCurrentConv = conv() === currentConversationIdRef.current;
      if (isCurrentConv) {
        ctx.setMessages(finalizeError);
        ctx.setIsStreaming(false);
        ctx.setStreamingConversationId(null);
        ctx.setAbortController(null);
        delete ctx.abortControllersRef.current[conv()];
        delete messagesCacheRef.current[conv()];
      } else {
        const cached = messagesCacheRef.current[conv()];
        if (cached) messagesCacheRef.current[conv()] = finalizeError(cached);
      }
    },
  };
}
