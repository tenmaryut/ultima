import './i18n';
import './ai-studio.css';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, Columns2, FileDown, Image as ImageIcon, MessagesSquare } from 'lucide-react';
import type { ModuleProps } from '../../core/modules';
import { ModuleLayout } from '../../components/layout/ModuleLayout';
import { ProviderPicker } from '../../components/ai/ProviderPicker';
import { Button, DropOverlay, Segmented, Select, confirmDialog, toast, type MenuEntry } from '../../components/ui';
import { useAppStore, type ModuleHandoff } from '../../core/store';
import { useT } from '../../core/i18n';
import { useModuleCommands } from '../../core/commands';
import { useFileDrop, useHandoffs } from '../../core/hooks';
import { pathForFile, pickFiles, saveFile } from '../../core/platform';
import { rememberRecent } from '../../core/open';
import { providerSupportsImages, resolveProvider } from '../../core/ai/client';
import { useAISettings } from '../../core/ai/settings';
import { fileExtension } from '../../core/utils/format';
import { useStudio } from './store';
import { BUILTIN_PERSONAS, findPersona, personaLabel } from './personas';
import { conversationToMarkdown, parseConversationProject, serializeConversation } from './persist';
import { useChatEngine } from './useChatEngine';
import { ATTACH_ACCEPT, textAttachment, urlToAttachment } from './attachments';
import { filesToAttachments } from './Composer';
import { ChatView, type Draft } from './ChatView';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { TemplateModal } from './TemplateModal';
import { PersonaModal } from './PersonaModal';
import { CompareView } from './CompareView';
import { ImagesView } from './ImagesView';
import { SpeechView } from './SpeechView';
import { ModelInput } from './ModelInput';
import { providerName } from './MessageItem';
import type { PromptTemplate } from './templates';
import type { Conversation } from './types';

type Tab = 'chat' | 'compare' | 'images' | 'speech';
const EMPTY_DRAFT: Draft = { text: '', attachments: [] };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chat';

export default function AiStudioModule({ active }: ModuleProps) {
  const t = useT();
  const language = useAppStore((s) => s.language);
  const conversations = useStudio((s) => s.conversations);
  const currentId = useStudio((s) => s.currentId);
  const customPersonas = useStudio((s) => s.personas);
  // re-render when AI connections change
  useAISettings((s) => s.statuses);
  useAISettings((s) => s.enabled);
  const engine = useChatEngine();
  const [tab, setTab] = useState<Tab>('chat');
  // Compare and Images stay mounted once opened, so their results survive switching tabs.
  const visited = useRef(new Set<Tab>());
  visited.current.add(tab);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [templateModal, setTemplateModal] = useState<{ initial: PromptTemplate | null } | null>(null);
  const [personaModal, setPersonaModal] = useState<{ editId: string | null } | null>(null);
  const paths = useRef(new Map<string, string>());
  const centerRef = useRef<HTMLDivElement>(null);

  // always have a conversation to type into
  useEffect(() => {
    const s = useStudio.getState();
    if (!s.conversations.length) s.newConversation();
    else if (!s.currentId || !s.conversations.some((c) => c.id === s.currentId)) s.select(s.conversations[0].id);
  }, [conversations.length, currentId]);

  const conv = conversations.find((c) => c.id === currentId) ?? null;
  const persona = findPersona(conv?.personaId ?? 'assistant', customPersonas);
  const providerId = resolveProvider(conv?.providerId ?? undefined);
  const imagesSupported = providerSupportsImages(providerId);
  const draft = (conv && drafts[conv.id]) || EMPTY_DRAFT;
  const setDraft = (d: Draft) => conv && setDrafts((all) => ({ ...all, [conv.id]: d }));
  const languageName = language === 'id' ? 'Indonesian (Bahasa Indonesia)' : 'English';
  const update = (fn: (c: Conversation) => Conversation) => conv && useStudio.getState().updateConversation(conv.id, fn, false);

  const newChat = () => {
    const s = useStudio.getState();
    const current = s.conversations.find((c) => c.id === s.currentId);
    // reuse an untouched empty chat instead of piling up empty ones
    if (current && !current.messages.length) {
      setTab('chat');
      return current.id;
    }
    const id = s.newConversation({ personaId: current?.personaId ?? 'assistant', providerId: current?.providerId ?? null, model: current?.model ?? '' });
    setTab('chat');
    return id;
  };

  /* --------------------------------- Files ---------------------------------- */

  const addToDraft = (convId: string, patch: (d: Draft) => Draft) => setDrafts((all) => ({ ...all, [convId]: patch(all[convId] ?? EMPTY_DRAFT) }));

  const openFiles = async (files: File[]) => {
    const others: File[] = [];
    for (const file of files) {
      const ext = fileExtension(file.name);
      if (ext === 'ultima' || (ext === 'json' && /"module"\s*:\s*"ai-studio"/.test(await file.slice(0, 4096).text()))) {
        try {
          const { conversation, persona: p } = parseConversationProject(await file.text());
          if (p && !useStudio.getState().personas.some((x) => x.id === p.id)) useStudio.getState().savePersona(p);
          const id = useStudio.getState().importConversation(conversation);
          const path = pathForFile(file);
          if (path) paths.current.set(id, path);
          rememberRecent(file, 'ai-studio');
          setTab('chat');
          toast.success(t('Chat opened'), conversation.title || file.name);
        } catch (error) {
          toast.error(t('Could not open {name}', { name: file.name }), error instanceof Error ? error.message : String(error));
        }
      } else others.push(file);
    }
    if (others.length) {
      const id = useStudio.getState().currentId ?? newChat();
      const list = await filesToAttachments(others, drafts[id]?.attachments ?? []);
      addToDraft(id, (d) => ({ ...d, attachments: list }));
      setTab('chat');
    }
  };

  const openDialog = async () => {
    const files = await pickFiles({ accept: `.ultima,${ATTACH_ACCEPT}`, multiple: true });
    if (files.length) await openFiles(files);
  };

  const dragging = useFileDrop(centerRef, (files) => void openFiles(files), active && tab === 'chat');

  const saveProject = async (c: Conversation | null, saveAs: boolean) => {
    if (!c) return;
    try {
      const result = await saveFile(serializeConversation(c, findPersona(c.personaId, useStudio.getState().personas)), {
        suggestedName: `${slug(c.title)}.ultima`,
        filters: [{ name: t('Ultima project'), extensions: ['ultima'] }],
        path: saveAs ? undefined : paths.current.get(c.id),
      });
      if (!result) return;
      if (result.path) paths.current.set(c.id, result.path);
      toast.success(t('Saved'), result.path ?? `${slug(c.title)}.ultima`);
    } catch (error) {
      toast.error(t('Could not save'), error instanceof Error ? error.message : String(error));
    }
  };

  const exportMarkdown = async (c: Conversation | null) => {
    if (!c) return;
    const p = findPersona(c.personaId, useStudio.getState().personas);
    const md = conversationToMarkdown(c, personaLabel(p, p.name, t), (id) => providerName(id));
    try {
      const result = await saveFile(new Blob([md], { type: 'text/markdown' }), { suggestedName: `${slug(c.title)}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result) toast.success(t('Exported as Markdown'));
    } catch (error) {
      toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
    }
  };

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: t('Clear all AI Studio data?'),
      message: t('All chats and custom personas stored on this computer will be deleted. This cannot be undone.'),
      confirmLabel: t('Delete everything'),
      danger: true,
    });
    if (!ok) return;
    useStudio.getState().clearAll();
    setDrafts({});
    paths.current.clear();
    toast.success(t('All AI Studio data was deleted'));
  };

  const deleteCurrent = async () => {
    if (!conv) return;
    if (await confirmDialog({ title: t('Delete “{name}”?', { name: conv.title || t('New chat') }), message: t('This cannot be undone.'), confirmLabel: t('Delete'), danger: true })) {
      useStudio.getState().removeConversation(conv.id);
    }
  };

  /* -------------------------------- Handoffs -------------------------------- */

  useHandoffs('ai-studio', (items: ModuleHandoff[]) => {
    const id = useStudio.getState().currentId ?? newChat();
    setTab('chat');
    for (const item of items) {
      if (item.kind === 'text' && item.text) addToDraft(id, (d) => ({ ...d, text: d.text ? `${d.text}\n\n${item.text}` : item.text! }));
      else if (item.kind === 'image' && item.image) {
        void urlToAttachment(item.image, `${item.title ? slug(item.title) : 'image'}.png`)
          .then((a) => addToDraft(id, (d) => ({ ...d, attachments: [...d.attachments, a].slice(0, 10) })))
          .catch((error) => toast.error(t('Could not attach the image'), error instanceof Error ? error.message : String(error)));
      } else if (item.kind === 'svg' && item.svg) addToDraft(id, (d) => ({ ...d, attachments: [...d.attachments, textAttachment(`${item.title ? slug(item.title) : 'drawing'}.svg`, item.svg!)] }));
      else if (item.kind === 'palette' && item.palette?.length) addToDraft(id, (d) => ({ ...d, text: `${d.text ? `${d.text}\n` : ''}${t('My palette')}: ${item.palette!.join(', ')}\n` }));
      else if (item.kind === 'json' && item.json !== undefined) addToDraft(id, (d) => ({ ...d, attachments: [...d.attachments, textAttachment('data.json', JSON.stringify(item.json, null, 2))] }));
      else if (item.kind === 'files' && item.files?.length) void openFiles(item.files);
    }
  });

  /* -------------------------------- Commands -------------------------------- */

  useModuleCommands('ai-studio', {
    new: () => void newChat(),
    open: () => void openDialog(),
    save: () => void saveProject(conv, false),
    'save-as': () => void saveProject(conv, true),
    export: () => void exportMarkdown(conv),
    delete: () => {
      if (tab !== 'chat' || !conv) return false;
      void deleteCurrent();
    },
    duplicate: () => {
      if (!conv) return false;
      useStudio.getState().duplicateConversation(conv.id, t('(copy)'));
    },
  });

  const menus: { label: string; entries: MenuEntry[] | (() => MenuEntry[]) }[] = [
    {
      label: t('File'),
      entries: () => [
        { label: t('New chat'), shortcut: 'Ctrl+N', onClick: () => void newChat() },
        { label: t('Open…'), shortcut: 'Ctrl+O', onClick: () => void openDialog() },
        { type: 'separator' },
        { label: t('Save chat'), shortcut: 'Ctrl+S', disabled: !conv, onClick: () => void saveProject(conv, false) },
        { label: t('Save chat as…'), shortcut: 'Ctrl+Shift+S', disabled: !conv, onClick: () => void saveProject(conv, true) },
        { label: t('Export as Markdown…'), shortcut: 'Ctrl+E', disabled: !conv?.messages.length, onClick: () => void exportMarkdown(conv) },
        { type: 'separator' },
        { label: t('Clear all data…'), onClick: () => void clearAll() },
      ],
    },
    {
      label: t('Chat'),
      entries: () => [
        { label: t('Regenerate last answer'), disabled: !conv?.messages.length || (conv ? engine.busy.has(conv.id) : true), onClick: () => conv && engine.regenerate(conv.id) },
        { label: t('Stop'), disabled: !conv || !engine.busy.has(conv.id), onClick: () => conv && engine.stop(conv.id) },
        { type: 'separator' },
        { label: t('Prompt library…'), onClick: () => setTemplateModal({ initial: null }) },
        { label: t('Custom personas…'), onClick: () => setPersonaModal({ editId: null }) },
        { type: 'separator' },
        { label: t('Duplicate chat'), shortcut: 'Ctrl+D', disabled: !conv, onClick: () => conv && useStudio.getState().duplicateConversation(conv.id, t('(copy)')) },
        { label: t('Delete chat'), disabled: !conv, onClick: () => void deleteCurrent() },
      ],
    },
  ];

  const applyTemplate = (prompt: string, tpl: PromptTemplate, send: boolean) => {
    if (!conv) return;
    setTemplateModal(null);
    setTab('chat');
    // switch to the template's persona when the chat has not started yet
    if (tpl.persona && !conv.messages.length && BUILTIN_PERSONAS.some((p) => p.id === tpl.persona)) update((c) => ({ ...c, personaId: tpl.persona! }));
    if (send) {
      if (engine.busy.has(conv.id)) {
        setDraft({ ...draft, text: prompt });
        return;
      }
      engine.send(conv.id, prompt, draft.attachments);
      setDraft(EMPTY_DRAFT);
    } else setDraft({ ...draft, text: draft.text ? `${draft.text}\n\n${prompt}` : prompt });
  };

  const tabs = [
    { value: 'chat' as const, label: t('Chat'), icon: MessagesSquare },
    { value: 'compare' as const, label: t('Compare'), icon: Columns2 },
    { value: 'images' as const, label: t('Images'), icon: ImageIcon },
    { value: 'speech' as const, label: t('Speech'), icon: AudioLines },
  ];

  return (
    <ModuleLayout
      moduleId="ai-studio"
      title={tab === 'chat' ? conv?.title || t('New chat') : undefined}
      menus={menus}
      toolbar={
        <>
          <Segmented<Tab> value={tab} onChange={setTab} options={tabs} />
          {tab === 'chat' && conv && (
            <>
              <span className="vsep" />
              <Select
                small
                value={conv.personaId}
                onChange={(personaId) => update((c) => ({ ...c, personaId }))}
                options={[...BUILTIN_PERSONAS.map((p) => ({ value: p.id, label: t(p.name) })), ...customPersonas.map((p) => ({ value: p.id, label: `★ ${p.name}` }))]}
                style={{ width: 190 }}
                aria-label={t('Persona')}
                title={t('Persona')}
              />
              <ProviderPicker value={providerId} onChange={(id) => update((c) => ({ ...c, providerId: id }))} />
              <ModelInput providerId={providerId} value={conv.model} onChange={(model) => update((c) => ({ ...c, model }))} />
            </>
          )}
        </>
      }
      actions={
        tab === 'chat' ? (
          <Button size="sm" icon={FileDown} disabled={!conv?.messages.length} onClick={() => void exportMarkdown(conv)} title={t('Export as Markdown…')}>
            {t('Export')}
          </Button>
        ) : undefined
      }
      left={<Sidebar busy={engine.busy} onNew={() => void newChat()} onExportMarkdown={(c) => void exportMarkdown(c)} onSaveProject={(c) => void saveProject(c, true)} onClearAll={() => void clearAll()} />}
      right={
        tab === 'chat' && conv ? (
          <RightPanel
            conv={conv}
            persona={persona}
            onPersona={(personaId) => update((c) => ({ ...c, personaId }))}
            onManagePersonas={(editId) => setPersonaModal({ editId })}
            onTemplate={(tpl) => setTemplateModal({ initial: tpl })}
          />
        ) : undefined
      }
      status={
        <>
          <span>
            {providerId ? `${providerName(providerId)}${conv?.model ? ` · ${conv.model}` : ''}` : t('No AI connected')}
          </span>
          {providerId && <span>{imagesSupported ? t('Understands images') : t('Text only')}</span>}
          {tab === 'chat' && conv && <span>{t('{count} messages', { count: conv.messages.length })}</span>}
          <span className="spacer" />
          <span className="faint">{t('Answers come from your own AI tools — check important facts.')}</span>
        </>
      }
    >
      <div className="as-center" ref={centerRef}>
        <DropOverlay show={dragging} label={t('Drop images or text files to attach them')} />
        {tab === 'chat' && conv && (
          <ChatView
            conv={conv}
            persona={persona}
            engine={engine}
            draft={draft}
            setDraft={setDraft}
            noProvider={!providerId}
            imagesSupported={imagesSupported}
            onOpenTemplates={() => setTemplateModal({ initial: null })}
          />
        )}
        {visited.current.has('compare') && (
          <div className="as-pane" hidden={tab !== 'compare'}>
            <CompareView persona={persona} onOpenChat={() => setTab('chat')} />
          </div>
        )}
        {visited.current.has('images') && (
          <div className="as-pane" hidden={tab !== 'images'}>
            <ImagesView active={active && tab === 'images'} />
          </div>
        )}
        {visited.current.has('speech') && (
          <div className="as-pane" hidden={tab !== 'speech'}>
            <SpeechView active={active && tab === 'speech'} />
          </div>
        )}
      </div>
      {templateModal && (
        <TemplateModal language={languageName} initial={templateModal.initial} onClose={() => setTemplateModal(null)} onUse={applyTemplate} canSend={Boolean(providerId) && !(conv && engine.busy.has(conv.id))} />
      )}
      {personaModal && (
        <PersonaModal
          editId={personaModal.editId}
          onClose={() => setPersonaModal(null)}
          onCreated={(id) => update((c) => ({ ...c, personaId: id }))}
        />
      )}
    </ModuleLayout>
  );
}
