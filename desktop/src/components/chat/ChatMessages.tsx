import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, RotateCcw, ThumbsUp, ThumbsDown } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage } from "@/hooks/use-chat";
import { ChatToolCall } from "./ChatToolCall";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className={`rounded-md p-1.5 transition-colors ${copied ? "text-emerald-500" : "text-muted-foreground hover:text-foreground"}`}
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function MessageActions({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <CopyButton text={text} />
      <button
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        title="Good response"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        title="Bad response"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      <button
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        title="Retry"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="group py-5 px-4 md:px-0">
      <div className="mx-auto max-w-3xl">
        {/* Label */}
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs font-semibold">You</span>
        </div>
        {/* Content */}
        <div className="rounded-2xl bg-muted px-4 py-3">
          <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="group py-5 px-4 md:px-0">
      <div className="mx-auto max-w-3xl">
        {/* Label row */}
        <div className="mb-1.5 flex items-center gap-2">
          {/* AI Matrx logo mark */}
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/85">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <span className="text-xs font-semibold">AI Matrx</span>
          {message.model && !message.isStreaming && (
            <span className="text-[10px] text-muted-foreground">
              {message.model.replace("claude-", "").replace(/-\d+$/, "")}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="chat-prose text-[0.9375rem] leading-[1.7]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => (
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[0.8125rem]">
                  {children}
                </pre>
              ),
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                if (isInline) {
                  return (
                    <code
                      className="rounded bg-muted px-1.5 py-0.5 text-[0.8125rem] font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>

          {/* Streaming cursor */}
          {message.isStreaming && (
            <span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse bg-primary align-text-bottom" />
          )}
        </div>

        {/* Tool calls */}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.tool_calls.map((tc) => (
              <ChatToolCall
                key={tc.id}
                toolCall={tc}
                result={message.tool_results?.find(
                  (r) => r.tool_call_id === tc.id
                )}
              />
            ))}
          </div>
        )}

        {/* Action buttons */}
        {!message.isStreaming && message.content && (
          <div className="mt-2">
            <MessageActions text={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="py-5 px-4 md:px-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1.5 flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/85">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <span className="text-xs font-semibold">AI Matrx</span>
        </div>
        <div className="flex items-center gap-1.5 py-1">
          <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

export function ChatMessages({ messages, isStreaming }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="py-2">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AssistantMessage key={msg.id} message={msg} />
          )
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
