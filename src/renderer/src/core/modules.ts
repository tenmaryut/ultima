import type { ComponentType } from 'react';
import {
  Aperture,
  AudioWaveform,
  Bot,
  Clapperboard,
  FileText,
  House,
  Image as ImageIcon,
  LayoutTemplate,
  Orbit,
  Palette,
  PenTool,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleId } from './store';
import { fileExtension } from './utils/format';

export interface ModuleProps {
  /** True while this module is the visible one. Pause animation loops/listeners when false. */
  active: boolean;
}

export interface ModuleDefinition {
  id: ModuleId;
  /** English name (translated with t()). */
  name: string;
  /** Short label for the side rail. */
  short: string;
  description: string;
  /** The familiar app this module covers, e.g. "Photoshop". */
  replaces?: string;
  icon: LucideIcon;
  color: string;
  section: 'home' | 'create' | 'tools' | 'system';
  load: () => Promise<{ default: ComponentType<ModuleProps> }>;
  /** File extensions (lowercase, no dot) this module opens. */
  extensions?: string[];
}

export const MODULES: ModuleDefinition[] = [
  {
    id: 'home',
    name: 'Home',
    short: 'Home',
    description: 'Start screen, recent files and quick actions.',
    icon: House,
    color: '#7c5cff',
    section: 'home',
    load: () => import('../modules/home'),
  },
  {
    id: 'photo',
    name: 'Photo Editor',
    short: 'Photo',
    description: 'Layers, selections, brushes, filters, adjustments and retouching for raster images.',
    replaces: 'Photoshop',
    icon: ImageIcon,
    color: '#31a8ff',
    section: 'create',
    load: () => import('../modules/photo'),
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'psd', 'ico'],
  },
  {
    id: 'develop',
    name: 'Photo Develop',
    short: 'Develop',
    description: 'Non-destructive photo development, presets and batch export for whole shoots.',
    replaces: 'Lightroom',
    icon: Aperture,
    color: '#22c3e6',
    section: 'create',
    load: () => import('../modules/develop'),
    // Camera RAW (embedded previews) and TIFF are decoded by Photo Develop.
    extensions: ['tif', 'tiff', 'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'raw', 'rwl', '3fr', 'iiq', 'x3f'],
  },
  {
    id: 'vector',
    name: 'Vector Designer',
    short: 'Vector',
    description: 'Shapes, pen tool, text, gradients and SVG/PDF export for logos and illustrations.',
    replaces: 'Illustrator',
    icon: PenTool,
    color: '#ff9a00',
    section: 'create',
    load: () => import('../modules/vector'),
    extensions: ['svg'],
  },
  {
    id: 'layout',
    name: 'Layout & Publishing',
    short: 'Layout',
    description: 'Multi-page documents, posters, flyers and social posts with print-ready PDF export.',
    replaces: 'InDesign / Express',
    icon: LayoutTemplate,
    color: '#ff3d71',
    section: 'create',
    load: () => import('../modules/layout'),
  },
  {
    id: 'video',
    name: 'Video Editor',
    short: 'Video',
    description: 'Multi-track timeline, trimming, titles, transitions, captions and MP4/WebM export.',
    replaces: 'Premiere Pro',
    icon: Clapperboard,
    color: '#8b7bff',
    section: 'create',
    load: () => import('../modules/video'),
    extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'],
  },
  {
    id: 'motion',
    name: 'Motion Graphics',
    short: 'Motion',
    description: 'Keyframe animation of text, shapes and images with easing, exported as video or GIF.',
    replaces: 'After Effects',
    icon: Orbit,
    color: '#c084fc',
    section: 'create',
    load: () => import('../modules/motion'),
  },
  {
    id: 'audio',
    name: 'Audio Editor',
    short: 'Audio',
    description: 'Waveform editing, effects, noise cleanup, recording and WAV export.',
    replaces: 'Audition',
    icon: AudioWaveform,
    color: '#10d9b0',
    section: 'create',
    load: () => import('../modules/audio'),
    extensions: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'weba'],
  },
  {
    id: 'pdf',
    name: 'PDF Studio',
    short: 'PDF',
    description: 'View, merge, split, reorder, annotate, sign and fill PDF documents.',
    replaces: 'Acrobat',
    icon: FileText,
    color: '#f43f5e',
    section: 'tools',
    load: () => import('../modules/pdf'),
    extensions: ['pdf'],
  },
  {
    id: 'color',
    name: 'Color Studio',
    short: 'Color',
    description: 'Color wheel harmonies, palettes from images, contrast checker and palette export.',
    replaces: 'Adobe Color',
    icon: Palette,
    color: '#f59e0b',
    section: 'tools',
    load: () => import('../modules/color'),
    extensions: ['ase', 'gpl'],
  },
  {
    id: 'ai-studio',
    name: 'AI Studio',
    short: 'AI',
    description: 'Chat with the AI tools you already pay for (or free local models) and send results to any module.',
    icon: Bot,
    color: '#a855f7',
    section: 'tools',
    load: () => import('../modules/ai-studio'),
  },
  {
    id: 'settings',
    name: 'Settings',
    short: 'Settings',
    description: 'Language, theme and AI connections.',
    icon: Settings,
    color: '#8e939d',
    section: 'system',
    load: () => import('../modules/settings'),
  },
];

export function getModule(id: ModuleId): ModuleDefinition {
  const found = MODULES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown module ${id}`);
  return found;
}

/** Picks the module that should open a file, based on its extension. */
export function moduleForFile(file: File): ModuleId | null {
  const ext = fileExtension(file.name);
  if (ext === 'ultima') return null; // project files: caller inspects the JSON header
  for (const m of MODULES) if (m.extensions?.includes(ext)) return m.id;
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/pdf') return 'pdf';
  return null;
}

/** Reads the module id out of an Ultima project file ({ app: 'ultima', module: '<id>' }). */
export async function moduleForProjectFile(file: File): Promise<ModuleId | null> {
  try {
    const head = await file.slice(0, 4096).text();
    const match = /"module"\s*:\s*"([a-z-]+)"/.exec(head);
    const id = match?.[1] as ModuleId | undefined;
    return id && MODULES.some((m) => m.id === id) ? id : null;
  } catch {
    return null;
  }
}
