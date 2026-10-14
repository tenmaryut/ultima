import type { Frame } from '../types';
import { F, ellipse, image, linear, makeDoc, rect, shadow, star, text, triangle, type TemplateDef } from './kit';

/* ------------------------------ Instagram post ------------------------------ */

function instagramPost() {
  return makeDoc({
    name: 'Instagram post',
    preset: 'instagram-post',
    swatches: ['#18181b', '#fdf6ec', '#ff5a36', '#1e3a8a', '#8b8b94', '#ffd23f'],
    pages: [
      {
        background: '$1',
        frames: [
          ellipse(820, -140, 380, 380, '$5', { opacity: 0.55, name: 'Blob' }),
          image(80, 80, 920, 560, '$4', { radius: 36, name: 'Photo' }),
          rect(112, 112, 236, 58, '$2', { radius: 29, name: 'Pill' }),
          text(112, 112, 236, 58, 'NEW CLASS', { size: 22, weight: 800, ls: 150, color: '$1', align: 'center', valign: 'middle' }),
          text(80, 676, 700, 220, 'Pottery for\nbeginners', { style: 'title', family: F.elegant, size: 100, weight: 700, lh: 1.0, ls: -10, color: '$0' }),
          text(80, 906, 700, 44, 'Saturdays  ·  10 AM  ·  All materials included', { size: 30, color: '$0', opacity: 0.7 }),
          text(80, 976, 600, 40, '@clayhouse.studio', { size: 28, weight: 700, color: '$2' }),
          ellipse(812, 744, 196, 196, '$2', { shadow: shadow(0, 16, 30, 'rgba(0, 0, 0, 0.18)') }),
          text(812, 744, 196, 196, 'Book\nnow', { size: 38, weight: 800, lh: 1.0, color: '$1', align: 'center', valign: 'middle' }),
        ],
      },
    ],
    styleScale: 2,
  });
}

/* ------------------------------ Instagram story ----------------------------- */

function instagramStory() {
  return makeDoc({
    name: 'Instagram story',
    preset: 'instagram-story',
    swatches: ['#0f0f1a', '#ffffff', '#7c3aed', '#f43f5e', '#9ca3af', '#67e8f9'],
    pages: [
      {
        background: '$2',
        gradient: linear(160, '$2', '$3'),
        frames: [
          ellipse(-220, -160, 720, 720, '$1', { opacity: 0.08 }),
          ellipse(640, 1440, 720, 720, '$1', { opacity: 0.08 }),
          star(860, 300, 70, 70, '$5', { opacity: 0.9 }),
          star(170, 960, 46, 46, '$1', { opacity: 0.7 }),
          rect(330, 250, 420, 84, '$1', { radius: 42, opacity: 0.18 }),
          text(330, 250, 420, 84, 'NEW EPISODE', { size: 30, weight: 800, ls: 300, color: '$1', align: 'center', valign: 'middle' }),
          image(290, 410, 500, 500, '$1', { radius: 250, name: 'Guest photo', stroke: '$1', sw: 10 }),
          text(140, 968, 800, 60, 'EP. 42', { size: 42, weight: 800, ls: 300, color: '$5', align: 'center' }),
          text(70, 1040, 940, 430, 'How to start\nbefore you’re\nready', {
            style: 'title',
            family: F.display,
            size: 106,
            weight: 900,
            lh: 1.0,
            color: '$1',
            align: 'center',
            valign: 'middle',
          }),
          text(140, 1484, 800, 56, 'with designer Maya Okafor', { size: 38, italic: true, color: '$1', align: 'center', opacity: 0.9 }),
          rect(290, 1640, 500, 116, '$1', { radius: 58, shadow: shadow(0, 18, 40, 'rgba(0, 0, 0, 0.25)') }),
          text(290, 1640, 500, 116, 'Listen now', { size: 42, weight: 800, color: '$2', align: 'center', valign: 'middle' }),
          text(290, 1776, 500, 44, 'Link in bio', { size: 28, color: '$1', align: 'center', opacity: 0.8 }),
        ],
      },
    ],
    styleScale: 2,
  });
}

/* ----------------------------- YouTube thumbnail ---------------------------- */

function youtubeThumbnail() {
  return makeDoc({
    name: 'YouTube thumbnail',
    preset: 'youtube-thumbnail',
    swatches: ['#0b0b0f', '#ffffff', '#ff0033', '#1f2937', '#9ca3af', '#facc15'],
    pages: [
      {
        background: '$3',
        gradient: linear(120, '$3', '$0'),
        frames: [
          image(720, 0, 560, 720, '$4', { name: 'Your photo' }),
          rect(650, -120, 56, 980, '$5', { rotation: 12, name: 'Accent' }),
          ellipse(56, 52, 176, 176, '$2', { shadow: shadow(0, 10, 0, 'rgba(0, 0, 0, 0.45)') }),
          text(56, 52, 176, 176, '10', { size: 104, weight: 900, color: '$1', align: 'center', valign: 'middle', family: F.display }),
          text(52, 262, 680, 136, 'PHOTO TIPS', { family: F.display, size: 118, weight: 900, lh: 1.0, color: '$1', shadow: shadow(6, 6, 0, 'rgba(0, 0, 0, 0.6)') }),
          text(52, 392, 680, 136, 'YOU NEED!', { family: F.display, size: 118, weight: 900, lh: 1.0, color: '$5', shadow: shadow(6, 6, 0, 'rgba(0, 0, 0, 0.6)') }),
          rect(56, 560, 440, 76, '$2', { radius: 14 }),
          text(56, 560, 440, 76, 'BEGINNER → PRO', { size: 38, weight: 800, ls: 40, color: '$1', align: 'center', valign: 'middle' }),
          triangle(606, 520, 84, 84, '$5', { rotation: 90, name: 'Arrow' }),
        ],
      },
    ],
    styleScale: 2,
  });
}

/* ----------------------------- Presentation deck ---------------------------- */

function presentation() {
  const agenda: Frame[] = [
    ['Highlights', 'Revenue grew 18% and churn fell to a record low'],
    ['Customer stories', 'What our biggest accounts told us this quarter'],
    ['Product roadmap', 'Three launches planned before the end of the year'],
    ['Next steps', 'Owners, timelines and how we will measure success'],
  ].flatMap(([title, desc], i) => {
    const y = 190 + i * 196;
    return [
      ellipse(760, y, 104, 104, '$5'),
      text(760, y, 104, 104, `0${i + 1}`, { size: 40, weight: 800, color: '$2', align: 'center', valign: 'middle' }),
      text(904, y + 4, 860, 56, title, { style: 'h1', size: 46, weight: 700, color: '$0' }),
      text(904, y + 62, 860, 40, desc, { size: 28, color: '$4' }),
    ];
  });
  const stats: Frame[] = [
    ['+18%', 'Revenue growth', 0.78, '$2'],
    ['4,200', 'New customers', 0.64, '$3'],
    ['96%', 'Satisfaction score', 0.96, '$2'],
  ].flatMap(([value, label, pct, color], i) => {
    const x = 140 + i * 560;
    return [
      rect(x, 300, 500, 380, '$1', { radius: 28, shadow: shadow(0, 20, 50, 'rgba(15, 23, 42, 0.10)') }),
      text(x + 50, 350, 400, 150, String(value), { size: 124, weight: 800, color: String(color), lh: 1.1, ls: -20 }),
      text(x + 50, 510, 400, 44, String(label), { size: 32, color: '$4' }),
      rect(x + 50, 600, 400, 14, '$5', { radius: 7 }),
      rect(x + 50, 600, 400 * Number(pct), 14, String(color), { radius: 7 }),
    ];
  });
  return makeDoc({
    name: 'Presentation',
    preset: 'presentation',
    swatches: ['#0f172a', '#ffffff', '#6366f1', '#0ea5e9', '#64748b', '#e8edf5'],
    styles: {
      title: { fontSize: 150, fontWeight: 800, lineHeight: 1.0, letterSpacing: -20 },
    },
    styleScale: 2,
    pages: [
      {
        background: '$0',
        frames: [
          ellipse(1240, -260, 920, 920, '$2', { gradient: linear(135, '$2', '$3'), opacity: 0.95 }),
          ellipse(1480, 640, 520, 520, '$3', { opacity: 0.35 }),
          ellipse(1180, 760, 120, 120, '', { stroke: '$1', sw: 3, opacity: 0.4 }),
          text(140, 300, 1000, 44, 'QUARTERLY REVIEW  ·  Q3 2026', { style: 'label', size: 28, ls: 300, color: '$3' }),
          text(140, 364, 1100, 340, 'Growing\ntogether', { style: 'title', color: '$1' }),
          text(140, 730, 1000, 56, 'Results, learnings and the road ahead', { size: 38, color: '$1', opacity: 0.72 }),
          text(140, 950, 1000, 40, 'Prepared by the Strategy Team  ·  October 2026', { size: 24, color: '$4' }),
        ],
      },
      {
        background: '$1',
        frames: [
          rect(-20, -20, 660, 1120, '$2', { gradient: linear(160, '$2', '$3') }),
          text(100, 150, 480, 120, 'Agenda', { size: 100, weight: 800, color: '$1', ls: -10, lh: 1.05 }),
          text(100, 276, 480, 50, 'What we’ll cover today', { size: 32, color: '$1', opacity: 0.85 }),
          ellipse(-120, 760, 420, 420, '$1', { opacity: 0.1 }),
          ...agenda,
        ],
      },
      {
        background: '$5',
        frames: [
          text(140, 110, 1200, 110, 'Q3 in numbers', { style: 'h1', size: 84, weight: 800, color: '$0', ls: -10 }),
          text(140, 212, 1200, 44, 'Every key metric moved in the right direction.', { size: 30, color: '$4' }),
          ...stats,
          text(140, 800, 1640, 70, 'Thank you!  Questions?', { size: 56, weight: 800, color: '$0' }),
          text(140, 880, 1640, 40, 'strategy@company.example', { size: 28, color: '$2' }),
        ],
      },
    ],
  });
}

/* ------------------------------ Facebook cover ------------------------------ */

function facebookCover() {
  return makeDoc({
    name: 'Facebook cover',
    preset: 'facebook-cover',
    swatches: ['#1c1917', '#fffbeb', '#ea580c', '#7c2d12', '#a8a29e', '#fde68a'],
    pages: [
      {
        background: '$1',
        frames: [
          rect(980, -40, 760, 720, '$2', { gradient: linear(135, '$2', '$3'), rotation: 8 }),
          image(1060, 72, 500, 480, '$4', { radius: 240, stroke: '$1', sw: 12 }),
          text(120, 150, 820, 70, 'FRESH EVERY MORNING', { style: 'label', size: 32, ls: 400, color: '$2' }),
          text(120, 220, 860, 220, 'Golden Crumb\nBakery', { family: F.elegant, size: 110, weight: 700, lh: 1.0, color: '$0' }),
          text(120, 470, 820, 50, 'Sourdough · Pastries · Coffee  —  open daily 7 AM', { size: 32, color: '$0', opacity: 0.75 }),
        ],
      },
    ],
    styleScale: 2,
  });
}

/* ------------------------------ LinkedIn banner ----------------------------- */

function linkedinBanner() {
  return makeDoc({
    name: 'LinkedIn banner',
    preset: 'linkedin-banner',
    swatches: ['#0f172a', '#f8fafc', '#2563eb', '#0f172a', '#94a3b8', '#38bdf8'],
    pages: [
      {
        background: '$3',
        gradient: linear(100, '$3', '#1e3a8a'),
        frames: [
          ellipse(1180, -180, 520, 520, '$5', { opacity: 0.18 }),
          ellipse(1380, 180, 300, 300, '$2', { opacity: 0.45 }),
          text(560, 110, 960, 70, 'Helping teams ship better products', { size: 54, weight: 800, color: '$1' }),
          text(560, 190, 960, 44, 'Product strategy  ·  Research  ·  Leadership', { size: 30, color: '$5' }),
          text(560, 260, 960, 40, 'Speaker · Mentor · Writer at productnotes.example', { size: 24, color: '$1', opacity: 0.7 }),
        ],
      },
    ],
    styleScale: 2,
  });
}

export const SOCIAL_TEMPLATES: TemplateDef[] = [
  { id: 'instagram-post', name: 'Instagram post', category: 'social', description: 'Workshop promo with photo, pill label and call to action', build: instagramPost },
  { id: 'instagram-story', name: 'Instagram story', category: 'social', description: 'Podcast episode story with gradient background', build: instagramStory },
  { id: 'youtube-thumbnail', name: 'YouTube thumbnail', category: 'social', description: 'High-contrast thumbnail with big number and photo', build: youtubeThumbnail },
  { id: 'facebook-cover', name: 'Facebook cover', category: 'social', description: 'Bakery cover photo with round image', build: facebookCover },
  { id: 'linkedin-banner', name: 'LinkedIn banner', category: 'social', description: 'Personal brand banner', build: linkedinBanner },
  { id: 'presentation', name: 'Presentation deck', category: 'presentation', description: 'Three 16:9 slides: title, agenda and key numbers', build: presentation },
];
