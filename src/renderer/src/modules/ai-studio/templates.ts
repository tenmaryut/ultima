/**
 * Prompt library: ready-made templates for creators, with fill-in fields.
 * Syntax: {{field}} is replaced by the field value; [[ … ]] is an optional part that is
 * dropped when any field used inside it is empty. Pure — unit tested.
 */

export interface TemplateField {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  /** Choices for a select field (English, translated in the UI). */
  options?: string[];
  default?: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  category: 'Social' | 'Video' | 'Writing' | 'Marketing' | 'Design' | 'Language' | 'Productivity';
  description: string;
  fields: TemplateField[];
  prompt: string;
  /** Persona that suits the template best. */
  persona?: string;
  /** The template sets the output language itself (no automatic language line). */
  ownLanguage?: boolean;
}

const tone: TemplateField = {
  key: 'tone',
  label: 'Tone',
  options: ['Friendly', 'Professional', 'Playful', 'Inspiring', 'Bold', 'Luxurious', 'Witty', 'Calm'],
  default: 'Friendly',
};
const audience: TemplateField = { key: 'audience', label: 'Audience', placeholder: 'e.g. young parents, small business owners' };

export const TEMPLATES: PromptTemplate[] = [
  {
    id: 'caption-hashtags',
    title: 'Caption + hashtags',
    category: 'Social',
    description: 'Scroll-stopping caption with a call to action and relevant hashtags.',
    persona: 'social',
    fields: [
      { key: 'topic', label: 'What is the post about?', placeholder: 'e.g. our new matcha latte', required: true, multiline: true },
      { key: 'platform', label: 'Platform', options: ['Instagram', 'TikTok', 'LinkedIn', 'X (Twitter)', 'Facebook', 'Threads'], default: 'Instagram' },
      tone,
      audience,
      { key: 'hashtags', label: 'Number of hashtags', default: '10' },
    ],
    prompt:
      'Write 3 caption options for a post on {{platform}} about: {{topic}}.\nTone: {{tone}}.[[ Audience: {{audience}}.]]\nEach caption: a strong hook in the first line, short body, a clear call to action and fitting emojis. Then list {{hashtags}} relevant hashtags (mix of popular and niche).',
  },
  {
    id: 'youtube-meta',
    title: 'YouTube title, description & chapters',
    category: 'Video',
    description: 'SEO friendly titles, a description and timestamped chapters.',
    persona: 'video-script',
    fields: [
      { key: 'summary', label: 'Video summary or script', required: true, multiline: true },
      { key: 'timestamps', label: 'Key moments with times (optional)', placeholder: '00:00 intro, 02:15 setup…', multiline: true },
      { key: 'keywords', label: 'Keywords', placeholder: 'e.g. budget travel, Bali' },
      { key: 'channel', label: 'Channel name' },
    ],
    prompt:
      'Create YouTube metadata for this video:\n{{summary}}\n[[Key moments: {{timestamps}}\n]][[Target keywords: {{keywords}}\n]][[Channel: {{channel}}\n]]\nGive: 5 title options (under 60 characters, curiosity + keyword), a description (hook in the first 2 lines, summary, links placeholder, call to subscribe), chapters in "00:00 Title" format, and 15 tags.',
  },
  {
    id: 'blog-outline',
    title: 'Blog post outline',
    category: 'Writing',
    description: 'Structured outline with headings, key points and SEO ideas.',
    persona: 'copywriter',
    fields: [
      { key: 'topic', label: 'Topic', required: true },
      audience,
      { key: 'length', label: 'Target length', options: ['800 words', '1500 words', '2500 words'], default: '1500 words' },
      tone,
    ],
    prompt:
      'Create a detailed outline for a {{length}} blog post about "{{topic}}".[[ Audience: {{audience}}.]] Tone: {{tone}}.\nInclude: 5 title ideas, an intro hook, H2/H3 headings with bullet points of what to cover, examples or data to include, a conclusion with a call to action, a meta description (155 characters) and 8 SEO keywords.',
  },
  {
    id: 'product-description',
    title: 'Product description',
    category: 'Marketing',
    description: 'Benefit-driven product copy for a shop or marketplace.',
    persona: 'copywriter',
    fields: [
      { key: 'product', label: 'Product name', required: true },
      { key: 'features', label: 'Features / specs', multiline: true, required: true },
      audience,
      tone,
      { key: 'length', label: 'Length', options: ['Short (50 words)', 'Medium (120 words)', 'Long (250 words)'], default: 'Medium (120 words)' },
    ],
    prompt:
      'Write a {{length}} product description for "{{product}}".\nFeatures: {{features}}\n[[Audience: {{audience}}. ]]Tone: {{tone}}.\nLead with the main benefit, turn features into benefits, use short scannable bullet points, and end with a call to action. Also give a 1-line SEO title.',
  },
  {
    id: 'ad-copy',
    title: 'Ad copy variations',
    category: 'Marketing',
    description: 'Headlines and texts to A/B test across ad platforms.',
    persona: 'copywriter',
    fields: [
      { key: 'product', label: 'Product or service', required: true },
      { key: 'offer', label: 'Offer / key message', placeholder: 'e.g. 20% off this week' },
      audience,
      { key: 'platform', label: 'Platform', options: ['Meta (Facebook/Instagram)', 'Google Search', 'TikTok', 'LinkedIn', 'YouTube'], default: 'Meta (Facebook/Instagram)' },
      { key: 'count', label: 'Number of variations', default: '5' },
    ],
    prompt:
      'Write {{count}} ad copy variations for {{product}} on {{platform}}.[[ Offer: {{offer}}.]][[ Audience: {{audience}}.]]\nRespect the platform\'s character limits. For each: headline, primary text, call-to-action button, and the angle used (pain point, benefit, social proof, urgency, curiosity…).',
  },
  {
    id: 'newsletter',
    title: 'Email newsletter',
    category: 'Marketing',
    description: 'A complete newsletter with subject lines and preview text.',
    persona: 'copywriter',
    fields: [
      { key: 'brand', label: 'Brand / sender', required: true },
      { key: 'news', label: 'What to share', multiline: true, required: true },
      { key: 'cta', label: 'Call to action', placeholder: 'e.g. Book a free call' },
      tone,
    ],
    prompt:
      'Write an email newsletter from {{brand}}.\nContent to share: {{news}}\n[[Main call to action: {{cta}}. ]]Tone: {{tone}}.\nGive 5 subject lines, a preview text, then the email with a greeting, short sections with headings, and a sign-off. Keep paragraphs short.',
  },
  {
    id: 'story-script',
    title: 'Short story / video script',
    category: 'Video',
    description: 'Script with scenes, narration and on-screen text.',
    persona: 'video-script',
    fields: [
      { key: 'premise', label: 'Idea / premise', required: true, multiline: true },
      { key: 'duration', label: 'Duration', options: ['15 seconds', '30 seconds', '60 seconds', '3 minutes', '10 minutes'], default: '60 seconds' },
      { key: 'platform', label: 'Platform', options: ['TikTok / Reels / Shorts', 'YouTube', 'Podcast', 'Ad'], default: 'TikTok / Reels / Shorts' },
      { key: 'characters', label: 'Characters (optional)' },
    ],
    prompt:
      'Write a {{duration}} script for {{platform}} based on: {{premise}}\n[[Characters: {{characters}}\n]]Start with a hook in the first 3 seconds. Format as a table or list of scenes with: time, visuals, narration/dialogue, on-screen text and sound. End with a payoff or call to action.',
  },
  {
    id: 'slogans',
    title: 'Slogan ideas',
    category: 'Marketing',
    description: 'Memorable taglines in different styles.',
    persona: 'copywriter',
    fields: [
      { key: 'brand', label: 'Brand', required: true },
      { key: 'what', label: 'What it does', required: true },
      { key: 'values', label: 'Values / personality', placeholder: 'e.g. honest, fast, local' },
      { key: 'count', label: 'How many', default: '15' },
    ],
    prompt:
      'Brainstorm {{count}} slogans for {{brand}}, which {{what}}.[[ Brand values: {{values}}.]]\nMix styles (rhyme, pun, promise, question, bold claim). Keep each under 8 words. Mark your top 3 with a short reason.',
  },
  {
    id: 'podcast-notes',
    title: 'Podcast show notes',
    category: 'Writing',
    description: 'Episode summary, key takeaways, timestamps and links.',
    persona: 'copywriter',
    fields: [
      { key: 'title', label: 'Episode title', required: true },
      { key: 'content', label: 'Transcript or summary', multiline: true, required: true },
      { key: 'guests', label: 'Guests' },
      { key: 'links', label: 'Links to include', multiline: true },
    ],
    prompt:
      'Write show notes for the podcast episode "{{title}}".[[ Guests: {{guests}}.]]\nSource:\n{{content}}\n\nInclude: a 2-sentence hook, an episode summary, 5 key takeaways, timestamps if they can be inferred, [[these links: {{links}}, ]]and a call to subscribe and review.',
  },
  {
    id: 'thumbnail-text',
    title: 'Thumbnail text ideas',
    category: 'Video',
    description: 'Short, punchy text overlays for video thumbnails.',
    persona: 'video-script',
    fields: [
      { key: 'topic', label: 'Video topic', required: true },
      { key: 'emotion', label: 'Emotion to trigger', options: ['Curiosity', 'Surprise', 'Fear of missing out', 'Excitement', 'Humor'], default: 'Curiosity' },
      { key: 'count', label: 'How many', default: '10' },
    ],
    prompt:
      'Give {{count}} thumbnail text ideas (max 4 words each) for a video about {{topic}} that trigger {{emotion}}. For each, suggest the image composition and 2 colors (as hex codes) for the text and its outline.',
  },
  {
    id: 'brand-voice',
    title: 'Brand voice guide',
    category: 'Marketing',
    description: 'Voice, tone rules, vocabulary and examples for a brand.',
    persona: 'copywriter',
    fields: [
      { key: 'brand', label: 'Brand', required: true },
      { key: 'about', label: 'What the brand does', multiline: true, required: true },
      audience,
      { key: 'values', label: 'Values / personality' },
    ],
    prompt:
      'Create a brand voice guide for {{brand}}: {{about}}[[ Audience: {{audience}}.]][[ Values: {{values}}.]]\nInclude: 3-4 voice traits (what it is / is not), tone by situation (social, support, ads, errors), words to use and avoid, grammar and emoji rules, and before/after example sentences.',
  },
  {
    id: 'content-calendar',
    title: 'Content calendar',
    category: 'Social',
    description: 'A posting plan with themes, formats and hooks.',
    persona: 'social',
    fields: [
      { key: 'niche', label: 'Brand / niche', required: true },
      { key: 'platforms', label: 'Platforms', default: 'Instagram, TikTok' },
      { key: 'weeks', label: 'Number of weeks', default: '4' },
      { key: 'frequency', label: 'Posts per week', default: '3' },
      { key: 'goal', label: 'Goal', options: ['Grow followers', 'Sell a product', 'Build community', 'Drive traffic'], default: 'Grow followers' },
    ],
    prompt:
      'Make a {{weeks}}-week content calendar for {{niche}} on {{platforms}}, {{frequency}} posts per week. Goal: {{goal}}.\nAs a table: week, day, platform, format (reel, carousel, story, post…), topic, hook, and call to action. Balance educational, entertaining and promotional posts.',
  },
  {
    id: 'press-release',
    title: 'Press release',
    category: 'Writing',
    description: 'A news-ready press release in standard format.',
    persona: 'copywriter',
    fields: [
      { key: 'company', label: 'Company', required: true },
      { key: 'news', label: 'Announcement', multiline: true, required: true },
      { key: 'quote', label: 'Spokesperson (name, role)' },
      { key: 'place', label: 'City and date', placeholder: 'e.g. Jakarta, 12 March 2026' },
    ],
    prompt:
      'Write a press release for {{company}} announcing: {{news}}\n[[Dateline: {{place}}. ]][[Include a quote from {{quote}}. ]]Use the standard format: headline, subheadline, dateline + lead paragraph (who, what, when, where, why), body, quote, boilerplate "About {{company}}", and media contact placeholder.',
  },
  {
    id: 'logo-brief',
    title: 'Logo design brief',
    category: 'Design',
    description: 'A clear brief for designing (or generating) a logo.',
    persona: 'brainstorm',
    fields: [
      { key: 'brand', label: 'Brand name', required: true },
      { key: 'industry', label: 'Industry', required: true },
      { key: 'values', label: 'Values / personality' },
      { key: 'style', label: 'Style preferences', placeholder: 'e.g. minimal, geometric, hand-drawn' },
      { key: 'colors', label: 'Color preferences' },
    ],
    prompt:
      'Write a logo design brief for {{brand}} ({{industry}}).[[ Values: {{values}}.]][[ Style: {{style}}.]][[ Colors: {{colors}}.]]\nInclude: brand summary, target audience, 3 concept directions (symbol idea, typography, why it fits), a color palette as hex codes, do\'s and don\'ts, and the deliverables (formats and versions).',
  },
  {
    id: 'palette-idea',
    title: 'Color palette idea',
    category: 'Design',
    description: '5 named hex colors with usage tips — open them in Color Studio.',
    persona: 'brainstorm',
    fields: [{ key: 'mood', label: 'Mood, brand or season', required: true, placeholder: 'e.g. calm wellness brand, summer festival' }],
    prompt:
      'Suggest a 5-color palette for: {{mood}}.\nList each color as "#RRGGBB — Name — where to use it" (background, text, accent…), from darkest to lightest. Check that the text/background pair has good contrast, then give 2 alternative palettes in the same format.',
  },
  {
    id: 'storyboard',
    title: 'Video storyboard',
    category: 'Video',
    description: 'Shot-by-shot storyboard with camera and transitions.',
    persona: 'video-script',
    fields: [
      { key: 'concept', label: 'Concept', required: true, multiline: true },
      { key: 'duration', label: 'Duration', default: '30 seconds' },
      { key: 'shots', label: 'Number of shots', default: '8' },
      { key: 'style', label: 'Visual style', placeholder: 'e.g. cinematic, bright and playful' },
    ],
    prompt:
      'Create a storyboard of {{shots}} shots for a {{duration}} video: {{concept}}[[ Visual style: {{style}}.]]\nFor every shot: number, duration, shot type and camera movement, what we see, audio/voice-over, text on screen and the transition to the next shot.',
  },
  {
    id: 'translate',
    title: 'Translate & localize',
    category: 'Language',
    description: 'Natural translation adapted to the local audience.',
    persona: 'translator',
    ownLanguage: true,
    fields: [
      { key: 'text', label: 'Text', multiline: true, required: true },
      { key: 'from', label: 'From', options: ['Auto-detect', 'English', 'Indonesian', 'Malay', 'Spanish', 'French', 'German', 'Japanese', 'Chinese'], default: 'Auto-detect' },
      { key: 'to', label: 'To', options: ['Indonesian', 'English', 'Malay', 'Spanish', 'French', 'German', 'Japanese', 'Chinese'], default: 'Indonesian' },
      { key: 'notes', label: 'Audience / locale notes', placeholder: 'e.g. casual Gen Z, formal business' },
    ],
    prompt:
      'Translate the text below from {{from}} to {{to}}. Localize it: adapt idioms, units, examples and tone so it sounds native, not translated.[[ Notes: {{notes}}.]]\nReturn the translation first, then a short list of the choices you made.\n\nText:\n{{text}}',
  },
  {
    id: 'proofread',
    title: 'Proofread & polish',
    category: 'Language',
    description: 'Fix grammar, spelling and flow; explain the changes.',
    persona: 'copywriter',
    ownLanguage: true,
    fields: [
      { key: 'text', label: 'Text', multiline: true, required: true },
      { key: 'style', label: 'Style', options: ['Keep my style', 'More formal', 'More casual', 'More concise', 'More persuasive'], default: 'Keep my style' },
    ],
    prompt:
      'Proofread the text below (keep its language). Style: {{style}}. Fix grammar, spelling, punctuation and awkward phrasing.\nReturn: the corrected text, then a bullet list of the main changes.\n\nText:\n{{text}}',
  },
  {
    id: 'summarize',
    title: 'Summarize text',
    category: 'Productivity',
    description: 'Key points, action items and a one-line TL;DR.',
    fields: [
      { key: 'text', label: 'Text', multiline: true, required: true },
      { key: 'points', label: 'Number of key points', default: '5' },
      { key: 'audience', label: 'Summary for', placeholder: 'e.g. my manager, a 12-year-old' },
    ],
    prompt:
      'Summarize the text below[[ for {{audience}}]]. Give a one-line TL;DR, {{points}} key points, and any action items or open questions.\n\nText:\n{{text}}',
  },
  {
    id: 'hooks',
    title: 'Hooks for short videos',
    category: 'Social',
    description: 'Opening lines that stop the scroll in the first 2 seconds.',
    persona: 'social',
    fields: [
      { key: 'topic', label: 'Topic', required: true },
      audience,
      { key: 'count', label: 'How many', default: '12' },
    ],
    prompt:
      'Write {{count}} hooks (first sentence spoken in a short video) about {{topic}}.[[ Audience: {{audience}}.]] Use different patterns: bold claim, question, mistake, story, number, contrarian. Keep each under 12 words.',
  },
  {
    id: 'bio',
    title: 'Social media bio',
    category: 'Social',
    description: 'Short bios that say who you are and what to do next.',
    persona: 'social',
    fields: [
      { key: 'who', label: 'Who you are / what you do', required: true, multiline: true },
      { key: 'platform', label: 'Platform', options: ['Instagram', 'TikTok', 'LinkedIn', 'X (Twitter)', 'YouTube'], default: 'Instagram' },
      tone,
    ],
    prompt:
      'Write 5 {{platform}} bio options for: {{who}}\nTone: {{tone}}. Respect the platform\'s character limit, include a clear value proposition and a call to action, and use emojis only where they help.',
  },
  {
    id: 'image-prompt',
    title: 'Image generation prompt',
    category: 'Design',
    description: 'Detailed prompts for Stable Diffusion and other image AIs.',
    persona: 'image-prompt',
    ownLanguage: true,
    fields: [
      { key: 'subject', label: 'Subject', required: true },
      { key: 'style', label: 'Style', options: ['Photorealistic', 'Cinematic', 'Illustration', 'Anime', '3D render', 'Watercolor', 'Flat vector', 'Pixel art'], default: 'Photorealistic' },
      { key: 'mood', label: 'Mood / lighting', placeholder: 'e.g. golden hour, moody, neon' },
      { key: 'aspect', label: 'Aspect ratio', options: ['1:1', '16:9', '9:16', '4:5', '3:2'], default: '1:1' },
    ],
    prompt:
      'Write 3 detailed English image generation prompts for: {{subject}}. Style: {{style}}.[[ Mood/lighting: {{mood}}.]] Aspect ratio {{aspect}}.\nFor each: the positive prompt (subject, composition, lighting, lens/medium, details, quality tags) and a negative prompt. Put each prompt in its own code block.',
  },
  {
    id: 'svg-icon',
    title: 'SVG icon or illustration',
    category: 'Design',
    description: 'A clean SVG you can open in Vector Designer.',
    persona: 'svg',
    fields: [
      { key: 'subject', label: 'What to draw', required: true },
      { key: 'style', label: 'Style', options: ['Flat', 'Line icon', 'Duotone', 'Geometric', 'Playful'], default: 'Flat' },
      { key: 'colors', label: 'Colors', placeholder: 'e.g. #1E5EB0, #F6C445' },
    ],
    prompt: 'Draw {{subject}} as a {{style}} SVG (viewBox 0 0 512 512).[[ Use these colors: {{colors}}.]]',
  },
  {
    id: 'photo-feedback',
    title: 'Photo editing plan',
    category: 'Design',
    description: 'Step-by-step edits for a photo (attach it if your AI sees images).',
    persona: 'photo-coach',
    fields: [
      { key: 'photo', label: 'Describe the photo (or attach it)', multiline: true, required: true },
      { key: 'look', label: 'Look you want', placeholder: 'e.g. warm film look, clean product shot' },
    ],
    prompt:
      'Here is my photo: {{photo}}\n[[I want this look: {{look}}.\n]]Give me an editing plan with exact slider values (exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation, HSL, curves, sharpening, grain, vignette) in the order to apply them, and explain why.',
  },
];

export const TEMPLATE_CATEGORIES = ['Social', 'Video', 'Writing', 'Marketing', 'Design', 'Language', 'Productivity'] as const;

/** Default values of a template's fields. */
export function templateDefaults(t: PromptTemplate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of t.fields) out[f.key] = f.default ?? '';
  return out;
}

/** Required fields that are still empty. */
export function missingFields(t: PromptTemplate, values: Record<string, string>): string[] {
  return t.fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.key);
}

/** Replaces {{field}} placeholders and drops [[optional]] parts whose fields are empty. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  const value = (key: string) => (values[key] ?? '').trim();
  const withOptional = template.replace(/\[\[([\s\S]*?)\]\]/g, (_, inner: string) => {
    const keys = [...inner.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)].map((m) => m[1]);
    return keys.every((k) => value(k)) ? inner : '';
  });
  return withOptional
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => value(key))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The final prompt for a template, adding the answer language unless the template sets it. */
export function buildTemplatePrompt(t: PromptTemplate, values: Record<string, string>, language: string): string {
  const text = fillTemplate(t.prompt, values);
  return t.ownLanguage || !language ? text : `${text}\n\nWrite the answer in ${language}.`;
}

/** Filters templates by search text (title, description, category — also translated) and category. */
export function searchTemplates(list: PromptTemplate[], query: string, category = '', translate: (s: string) => string = (s) => s): PromptTemplate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((t) => {
    if (category && t.category !== category) return false;
    const hay = [t.title, t.description, t.category].flatMap((s) => [s, translate(s)]).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
