"use client";

import { FormEvent, useState } from "react";
import { ArrowUp, Bot, LoaderCircle, Sparkles, X } from "lucide-react";
import type { AgentContext } from "@/lib/agent";
import type { AgentRunUsage } from "@/lib/agent";
import { getLimitedAppCheckToken } from "@/lib/firebase/client";

interface CareerAgentProps extends AgentContext {
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const starterPrompts = [
  "Create a concise career briefing from my strongest matches.",
  "Compare my top roles and explain the trade-offs.",
  "Prepare interview questions for my strongest match.",
];

export default function CareerAgent({
  preferences,
  savedJobIds,
  feedback,
  onClose,
}: CareerAgentProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [usage, setUsage] = useState<AgentRunUsage | null>(null);

  async function sendMessage(message: string) {
    const cleanMessage = message.trim();
    if (!cleanMessage || pending) return;

    const nextMessages = [
      ...messages,
      { role: "user" as const, content: cleanMessage },
    ];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setUsage(null);
    setPending(true);

    try {
      const appCheckToken = await getLimitedAppCheckToken();
      const response = await fetch("/api/agent", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Firebase-AppCheck": appCheckToken,
        },
        body: JSON.stringify({
          message: cleanMessage,
          preferences,
          savedJobIds,
          feedback,
          conversation: messages.slice(-6).map(({ role, content }) => ({
            role,
            content: content.slice(-1600),
          })),
        }),
      });
      const result = (await response.json()) as {
        answer?: string;
        error?: string;
        usage?: AgentRunUsage;
      };
      if (!response.ok || !result.answer) {
        setError(
          result.error ?? "The career agent could not complete that request.",
        );
        return;
      }
      setMessages([
        ...nextMessages,
        { role: "assistant", content: result.answer },
      ]);
      setUsage(result.usage ?? null);
    } catch {
      setError("Could not reach Workfinder. Check that the app is running.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <div
      className="agent-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="agent-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-title"
      >
        <header className="agent-header">
          <div className="agent-heading-mark">
            <Bot size={18} />
          </div>
          <div className="agent-heading-copy">
            <p className="eyebrow">WORKFINDER / CAREER AGENT</p>
            <h2 id="agent-title">Research together</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close career agent"
          >
            <X size={18} />
          </button>
        </header>

        <div className="agent-thread" aria-live="polite">
          {messages.length === 0 ? (
            <div className="agent-welcome">
              <span className="agent-spark">
                <Sparkles size={17} />
              </span>
              <h3>What should we work on?</h3>
              <p>
                I can research matches, compare roles, identify skill gaps, and
                prepare interview practice.
              </p>
              <div className="agent-starters">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    disabled={pending}
                  >
                    {prompt}
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                className={`agent-message ${message.role}`}
                key={`${message.role}-${index}`}
              >
                <span className="message-label">
                  {message.role === "user" ? "YOU" : "CAREER AGENT"}
                </span>
                <p>{message.content}</p>
              </article>
            ))
          )}
          {pending && (
            <div className="agent-thinking">
              <LoaderCircle size={15} /> Researching your listings...
            </div>
          )}
          {error && (
            <p className="agent-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <form className="agent-composer" onSubmit={handleSubmit}>
          <label className="agent-composer-label" htmlFor="agent-question">
            Ask about your career search
          </label>
          <div className="agent-input-row">
            <textarea
              id="agent-question"
              value={input}
              maxLength={4000}
              rows={3}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about a role, skill gap, or interview..."
            />
            <button
              type="submit"
              aria-label="Send to career agent"
              disabled={pending || !input.trim()}
            >
              <ArrowUp size={17} />
            </button>
          </div>
          <p className="agent-privacy">
            Your preferences and conversation go to the configured model
            endpoint. Token counts are associated with your Firebase account;
            prompts and responses are not stored in telemetry. No applications
            or messages are sent.
          </p>
          {usage && (
            <p className="agent-token-usage" role="status">
              Last run: {usage.totalTokens.toLocaleString()} tokens
              {usage.reportedUsageCalls < usage.completionCalls
                ? " · provider omitted some usage; reservation charged"
                : " · provider reported"}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
