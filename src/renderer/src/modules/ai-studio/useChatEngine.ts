/**
 * Sends chat messages to the selected AI (runAI) with streaming, stop, regenerate and
 * edit & resend. The CLIs are stateless, so each request carries a transcript of the
 * recent conversation (see transcript.ts).
 */
import { useCallback, useRef, useState } from 'react';
import type { AIImage } from '@shared/ai-types';
import { describeAIError, providerSupportsImages, resolveProvider, runAI } from '../../core/ai/client';
import { uid } from '../../core/utils/id';
import { t } from '../../core/i18n';
import { toast } from '../../components/ui';
import { useStudio } from './store';
import { findPersona, systemPromptOf } from './personas';
import { buildTranscriptPrompt, withAttachments } from './transcript';
import { attachmentToAIImage } from './attachments';
import { titleFrom } from './detect';
import type { Attachment, ChatMessage, Conversation } from './types';

export interface ChatEngine {
  /** Conversation ids with a reply in progress. */
  busy: Set<string>;
  send: (convId: string, text: string, attachments: Attachment[]) => void;
  regenerate: (convId: string) => void;
  editAndResend: (convId: string, messageId: string, text: string) => void;
  stop: (convId: string) => void;
}

/** History entries for the transcript (skips failed/empty replies). */
function historyOf(messages: ChatMessage[], imagesSupported: boolean) {
  return messages
    .filter((m) => m.status !== 'error' && (m.text.trim() || m.attachments?.length))
    .map((m) => ({ role: m.role, text: m.role === 'user' ? withAttachments(m.text, m.attachments, { imagesSupported, fileCap: 4000, totalCap: 8000 }) : m.text }));
}

export function useChatEngine(): ChatEngine {
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const controllers = useRef(new Map<string, AbortController>());

  const setBusyFor = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Runs the AI for `request` (the last user message) with `history` before it. */
  const reply = useCallback(async (convId: string, request: ChatMessage, history: ChatMessage[]) => {
    const store = useStudio.getState();
    const conv = store.conversations.find((c) => c.id === convId);
    if (!conv || controllers.current.has(convId)) return;
    const persona = findPersona(conv.personaId, store.personas);
    const providerId = resolveProvider(conv.providerId ?? undefined);
    const imagesSupported = providerSupportsImages(providerId);
    const answer: ChatMessage = {
      id: uid('m'),
      role: 'assistant',
      text: '',
      createdAt: Date.now(),
      status: 'streaming',
      providerId: providerId ?? undefined,
      model: conv.model || undefined,
    };
    store.updateConversation(convId, (c) => ({ ...c, messages: [...c.messages, answer] }));

    const images: AIImage[] = imagesSupported ? (request.attachments ?? []).map(attachmentToAIImage).filter((i): i is AIImage => Boolean(i)) : [];
    if (!imagesSupported && request.attachments?.some((a) => a.kind === 'image')) {
      toast.warning(t('This AI cannot see images'), t('The image is mentioned in the message but not sent. Pick an AI that understands images (Claude, Codex, Gemini, Ollama with a vision model…).'));
    } else if (imagesSupported && request.attachments?.some((a) => a.kind === 'image' && !a.dataUrl)) {
      toast.info(t('Images from earlier sessions are not stored'), t('Attach the image again to send it.'));
    }
    const requestText = withAttachments(request.text, request.attachments, { imagesSupported });
    const { prompt } = buildTranscriptPrompt(historyOf(history, imagesSupported), requestText, {
      maxMessages: store.settings.historyMessages,
      charBudget: store.settings.charBudget,
    });

    const ctrl = new AbortController();
    controllers.current.set(convId, ctrl);
    setBusyFor(convId, true);
    const started = performance.now();
    let pending: string | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending !== null) useStudio.getState().patchMessage(convId, answer.id, { text: pending });
      pending = null;
    };
    try {
      const result = await runAI({
        prompt,
        system: systemPromptOf(persona),
        images: images.length ? images : undefined,
        providerId: providerId ?? undefined,
        model: conv.model || undefined,
        signal: ctrl.signal,
        onText: (text) => {
          pending = text;
          if (!raf) raf = requestAnimationFrame(flush);
        },
      });
      if (raf) cancelAnimationFrame(raf);
      useStudio.getState().patchMessage(convId, answer.id, {
        text: result.text,
        status: 'done',
        providerId: result.providerId,
        durationMs: Math.round(result.durationMs || performance.now() - started),
      });
    } catch (error) {
      if (raf) cancelAnimationFrame(raf);
      const latest = useStudio.getState().conversations.find((c) => c.id === convId)?.messages.find((m) => m.id === answer.id);
      const partial = pending ?? latest?.text ?? '';
      if (ctrl.signal.aborted) {
        useStudio.getState().patchMessage(convId, answer.id, { text: partial, status: 'stopped', durationMs: Math.round(performance.now() - started) });
      } else {
        useStudio.getState().patchMessage(convId, answer.id, { text: partial, status: 'error', error: describeAIError(error) });
      }
    } finally {
      controllers.current.delete(convId);
      setBusyFor(convId, false);
    }
  }, []);

  const send = useCallback(
    (convId: string, text: string, attachments: Attachment[]) => {
      const trimmed = text.trim();
      if (!trimmed && !attachments.length) return;
      const store = useStudio.getState();
      const conv = store.conversations.find((c) => c.id === convId);
      if (!conv) return;
      const message: ChatMessage = { id: uid('m'), role: 'user', text: trimmed, createdAt: Date.now(), attachments: attachments.length ? attachments : undefined };
      const history = conv.messages;
      store.updateConversation(convId, (c) => ({
        ...c,
        title: c.title || titleFrom(trimmed) || attachments[0]?.name || t('New chat'),
        messages: [...c.messages, message],
      }));
      void reply(convId, message, history);
    },
    [reply],
  );

  const lastUserIndex = (c: Conversation) => {
    for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i].role === 'user') return i;
    return -1;
  };

  const regenerate = useCallback(
    (convId: string) => {
      const store = useStudio.getState();
      const conv = store.conversations.find((c) => c.id === convId);
      if (!conv || controllers.current.has(convId)) return;
      const ui = lastUserIndex(conv);
      if (ui < 0) return;
      const request = conv.messages[ui];
      store.updateConversation(convId, (c) => ({ ...c, messages: c.messages.slice(0, ui + 1) }));
      void reply(convId, request, conv.messages.slice(0, ui));
    },
    [reply],
  );

  const editAndResend = useCallback(
    (convId: string, messageId: string, text: string) => {
      const store = useStudio.getState();
      const conv = store.conversations.find((c) => c.id === convId);
      if (!conv || controllers.current.has(convId)) return;
      const index = conv.messages.findIndex((m) => m.id === messageId);
      if (index < 0 || conv.messages[index].role !== 'user' || !text.trim()) return;
      const edited: ChatMessage = { ...conv.messages[index], text: text.trim(), createdAt: Date.now() };
      store.updateConversation(convId, (c) => ({ ...c, messages: [...c.messages.slice(0, index), edited] }));
      void reply(convId, edited, conv.messages.slice(0, index));
    },
    [reply],
  );

  const stop = useCallback((convId: string) => controllers.current.get(convId)?.abort(), []);

  return { busy, send, regenerate, editAndResend, stop };
}
