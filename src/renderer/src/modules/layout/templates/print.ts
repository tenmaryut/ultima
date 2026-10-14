import type { Frame } from '../types';
import { F, diamond, ellipse, image, line, linear, makeDoc, rect, star, text, triangle, type TemplateDef } from './kit';

/* ------------------------------- Event poster ------------------------------ */

function eventPoster() {
  const W = 1728;
  const sunX = 264;
  const sunY = 250;
  const stripes: Frame[] = [
    [900, 14],
    [962, 22],
    [1032, 30],
    [1112, 40],
    [1204, 52],
    [1310, 64],
  ].map(([y, h]) => rect(sunX, y, 1200, h, '$3', { name: 'Stripe' }));
  return makeDoc({
    name: 'Event poster',
    preset: 'poster',
    swatches: ['#1b1036', '#fff4e6', '#ff4d6d', '#3a0ca3', '#7b6d8d', '#ffd166'],
    pages: [
      {
        background: '$3',
        frames: [
          text(100, 110, W - 200, 50, 'LIVE  ·  OUTDOOR  ·  ALL AGES', { size: 34, weight: 600, ls: 500, color: '$1', align: 'center' }),
          star(170, 230, 44, 44, '$5', { opacity: 0.9 }),
          star(1490, 190, 58, 58, '$5'),
          star(1380, 560, 30, 30, '$1', { opacity: 0.8 }),
          star(250, 720, 34, 34, '$1', { opacity: 0.7 }),
          ellipse(sunX, sunY, 1200, 1200, '$2', { gradient: linear(180, '$5', '$2'), name: 'Sun' }),
          ...stripes,
          rect(0, 1380, W, 924, '$3', { gradient: linear(180, '$3', '$0'), name: 'Ground' }),
          triangle(-120, 1090, 940, 440, '$0', { opacity: 0.55, name: 'Hill' }),
          triangle(880, 1040, 1000, 490, '$0', { opacity: 0.4, name: 'Hill' }),
          text(80, 1470, W - 160, 470, 'SUMMER\nSOUNDS', {
            style: 'title',
            family: F.display,
            size: 250,
            weight: 900,
            lh: 0.92,
            ls: -10,
            color: '$1',
            align: 'center',
            name: 'Title',
          }),
          text(100, 1945, W - 200, 60, 'MUSIC & ARTS FESTIVAL', { style: 'label', size: 48, ls: 400, color: '$5', align: 'center' }),
          text(100, 2030, W - 200, 76, 'AUG 14 — 16  ·  2026', { size: 60, weight: 800, color: '$1', align: 'center', ls: 60 }),
          text(100, 2122, W - 200, 50, 'THE MIDNIGHT ECHO  ·  NOVA BLUE  ·  KAI & THE TIDES  ·  LUMEN', {
            size: 34,
            weight: 500,
            ls: 80,
            color: '$1',
            align: 'center',
            opacity: 0.85,
          }),
          text(100, 2196, W - 200, 44, 'Riverside Park  ·  Gates open 4 PM  ·  Tickets at summersounds.example', {
            size: 28,
            color: '$5',
            align: 'center',
          }),
        ],
      },
    ],
    styleScale: 4,
  });
}

/* -------------------------------- Sale flyer -------------------------------- */

function saleFlyer() {
  const W = 528;
  return makeDoc({
    name: 'Sale flyer',
    preset: 'flyer',
    swatches: ['#14213d', '#fffaf2', '#e63946', '#1d3557', '#8d99ae', '#ffb703'],
    pages: [
      {
        background: '$1',
        frames: [
          rect(-140, 186, 820, 290, '$2', { rotation: -8, name: 'Band' }),
          text(40, 44, 300, 26, 'WEEKEND ONLY', { style: 'label', size: 15, ls: 300, color: '$2' }),
          text(40, 72, 300, 40, 'Harbor & Co.', { family: F.elegant, italic: true, size: 28, color: '$0' }),
          star(352, 54, 156, 156, '$5', { rotation: 12, name: 'Burst' }),
          text(352, 54, 156, 156, '50%\nOFF', { size: 32, weight: 900, lh: 0.95, color: '$0', align: 'center', valign: 'middle', rotation: 12 }),
          text(36, 214, 456, 236, 'BIG\nSALE', {
            style: 'title',
            family: F.display,
            size: 124,
            weight: 900,
            lh: 0.88,
            ls: -10,
            color: '$1',
            rotation: -8,
            valign: 'middle',
          }),
          text(40, 500, W - 80, 36, 'Up to 50% off everything in store', { size: 22, weight: 700, color: '$0', align: 'center' }),
          text(40, 538, W - 80, 26, 'Saturday & Sunday  ·  March 21–22  ·  10 AM – 8 PM', { size: 14, color: '$4', align: 'center' }),
          rect(84, 590, 360, 90, '', { stroke: '$0', sw: 2, dashed: true, radius: 12, name: 'Coupon' }),
          text(84, 590, 360, 90, 'USE CODE  SAVE50\nfor an extra 10% off at checkout', {
            size: 17,
            weight: 700,
            lh: 1.35,
            color: '$0',
            align: 'center',
            valign: 'middle',
          }),
          rect(-12, 726, W + 24, 102, '$3', { name: 'Footer' }),
          text(24, 726, W - 48, 90, '128 Harbor Street, Portside  ·  harborandco.example', {
            size: 13,
            ls: 40,
            color: '$1',
            align: 'center',
            valign: 'middle',
          }),
        ],
      },
    ],
    styleScale: 1,
  });
}

/* ------------------------------- Business card ------------------------------ */

function businessCard() {
  const W = 321.26;
  const H = 207.87;
  return makeDoc({
    name: 'Business card',
    preset: 'business-card',
    swatches: ['#1f2933', '#ffffff', '#0f766e', '#f59e0b', '#7b8794', '#e6fffa'],
    pages: [
      {
        background: '$1',
        frames: [
          rect(-12, -12, 24, H + 24, '$2', { name: 'Accent bar' }),
          text(34, 34, 200, 28, 'Alex Morgan', { size: 21, weight: 700, color: '$0', lh: 1.1 }),
          text(34, 62, 220, 18, 'Senior Product Designer', { style: 'label', size: 8.5, ls: 120, color: '$2' }),
          line(34, 94, 36, '$3', 2),
          text(34, 110, 250, 72, '+1 (555) 014-2290\nalex@morgan.studio\nmorgan.studio  ·  Portland, OR', { size: 9.5, lh: 1.65, color: '$0' }),
          ellipse(248, 30, 46, 46, '$2', { name: 'Monogram' }),
          text(248, 30, 46, 46, 'AM', { size: 16, weight: 800, ls: 40, color: '$1', align: 'center', valign: 'middle' }),
        ],
      },
      {
        background: '$2',
        gradient: linear(135, '$2', '$0'),
        frames: [
          ellipse(W / 2 - 36, 48, 72, 72, '', { stroke: '$1', sw: 2 }),
          text(W / 2 - 36, 48, 72, 72, 'AM', { size: 26, weight: 800, ls: 40, color: '$1', align: 'center', valign: 'middle' }),
          text(0, 136, W, 20, 'MORGAN STUDIO', { size: 11, weight: 600, ls: 400, color: '$1', align: 'center' }),
          text(0, 156, W, 16, 'Design for humans', { size: 8.5, italic: true, color: '$1', align: 'center', opacity: 0.8 }),
        ],
      },
    ],
    styleScale: 0.6,
  });
}

/* -------------------------------- Invitation -------------------------------- */

function invitation() {
  const W = 480;
  return makeDoc({
    name: 'Invitation',
    preset: 'card-5x7',
    swatches: ['#3d2c2e', '#fbf7f2', '#b08d57', '#7a8f7b', '#8f8078', '#efe6da'],
    pages: [
      {
        background: '$1',
        frames: [
          rect(22, 22, W - 44, 628, '', { stroke: '$2', sw: 1.5, name: 'Border' }),
          rect(32, 32, W - 64, 608, '', { stroke: '$2', sw: 0.75, name: 'Inner border' }),
          ellipse(W / 2 - 54, 56, 108, 54, '$3', { opacity: 0.18, name: 'Leaf' }),
          diamond(W / 2 - 8, 76, 16, 16, '$2'),
          line(150, 84, 72, '$2', 1),
          line(258, 84, 72, '$2', 1),
          text(60, 118, W - 120, 20, 'TOGETHER WITH THEIR FAMILIES', { size: 10, ls: 300, color: '$4', align: 'center' }),
          text(40, 150, W - 80, 200, 'Amelia\n&\nJames', {
            family: F.elegant,
            italic: true,
            size: 56,
            lh: 1.08,
            color: '$0',
            align: 'center',
            valign: 'middle',
            name: 'Names',
          }),
          text(60, 362, W - 120, 44, 'REQUEST THE PLEASURE OF YOUR COMPANY\nAT THE CELEBRATION OF THEIR MARRIAGE', {
            size: 9.5,
            ls: 200,
            lh: 1.9,
            color: '$4',
            align: 'center',
          }),
          text(40, 428, W - 80, 26, 'SATURDAY  ·  JUNE 20  ·  2026', { size: 16, weight: 600, ls: 220, color: '$0', align: 'center' }),
          text(40, 458, W - 80, 24, 'at four o’clock in the afternoon', { family: F.serif, italic: true, size: 15, color: '$0', align: 'center' }),
          text(40, 500, W - 80, 46, 'The Glasshouse Gardens\n12 Orchard Lane, Hillsborough', { family: F.serif, size: 14, lh: 1.5, color: '$0', align: 'center' }),
          line(W / 2 - 40, 570, 80, '$2', 1),
          text(40, 586, W - 80, 20, 'Kindly reply by May 1  ·  rsvp@ameliaandjames.example', { size: 9.5, ls: 60, color: '$4', align: 'center' }),
        ],
      },
    ],
  });
}

/* -------------------------------- Certificate ------------------------------- */

function certificate() {
  const W = 1056;
  return makeDoc({
    name: 'Certificate',
    preset: 'letter',
    landscape: true,
    swatches: ['#1c2541', '#fffdf7', '#c9a227', '#3a506b', '#8a8f98', '#f4ecd8'],
    pages: [
      {
        background: '$1',
        frames: [
          rect(0, 0, W, 816, '$5', { opacity: 0.35, name: 'Paper tint' }),
          rect(28, 28, W - 56, 760, '', { stroke: '$3', sw: 10, name: 'Frame' }),
          rect(50, 50, W - 100, 716, '', { stroke: '$2', sw: 2, name: 'Inner frame' }),
          diamond(39, 39, 22, 22, '$2'),
          diamond(W - 61, 39, 22, 22, '$2'),
          diamond(39, 755, 22, 22, '$2'),
          diamond(W - 61, 755, 22, 22, '$2'),
          text(128, 112, 800, 84, 'CERTIFICATE', { family: F.elegant, size: 66, weight: 700, ls: 200, color: '$0', align: 'center' }),
          text(128, 198, 800, 30, 'OF ACHIEVEMENT', { size: 20, weight: 600, ls: 600, color: '$2', align: 'center' }),
          line(W / 2 - 120, 258, 240, '$2', 1.5),
          text(128, 284, 800, 30, 'This certificate is proudly presented to', { family: F.serif, italic: true, size: 20, color: '$4', align: 'center' }),
          text(128, 322, 800, 96, 'Jordan Lee', { family: F.elegant, italic: true, size: 72, color: '$0', align: 'center', name: 'Recipient' }),
          line(W / 2 - 200, 430, 400, '$0', 1),
          text(228, 448, 600, 64, 'In recognition of outstanding dedication and excellence in completing the Advanced Leadership Program, 2026.', {
            family: F.serif,
            size: 17,
            lh: 1.5,
            color: '$0',
            align: 'center',
          }),
          star(W / 2 - 56, 540, 112, 112, '$2', { name: 'Seal' }),
          ellipse(W / 2 - 36, 567, 72, 72, '$1', { stroke: '$2', sw: 2 }),
          text(W / 2 - 36, 567, 72, 72, '2026', { size: 15, weight: 700, ls: 60, color: '$2', align: 'center', valign: 'middle' }),
          line(150, 662, 250, '$0', 1),
          text(150, 672, 250, 46, 'Dr. Maya Chen\nProgram Director', { size: 14, lh: 1.45, color: '$0', align: 'center' }),
          line(W - 400, 662, 250, '$0', 1),
          text(W - 400, 672, 250, 46, 'Samuel Ortiz\nHead of Learning', { size: 14, lh: 1.45, color: '$0', align: 'center' }),
        ],
      },
    ],
  });
}

/* ------------------------------ Restaurant menu ----------------------------- */

interface MenuItem {
  name: string;
  price: string;
  desc: string;
}

function menuSection(x: number, y: number, w: number, title: string, items: MenuItem[]): { frames: Frame[]; bottom: number } {
  const frames: Frame[] = [
    text(x, y, w, 40, title, { family: F.elegant, italic: true, size: 30, color: '$2', name: title }),
    line(x, y + 46, 48, '$2', 1.5),
  ];
  let cy = y + 62;
  for (const item of items) {
    frames.push(text(x, cy, w - 64, 22, item.name, { size: 14.5, weight: 700, color: '$0' }));
    frames.push(text(x + w - 64, cy, 64, 22, item.price, { size: 14.5, weight: 700, color: '$0', align: 'right' }));
    frames.push(text(x, cy + 22, w - 40, 22, item.desc, { size: 12, italic: true, color: '$4' }));
    cy += 58;
  }
  return { frames, bottom: cy };
}

function restaurantMenu() {
  const W = 793.7;
  const colW = 317;
  const left = 60;
  const right = 417;
  const a = menuSection(left, 240, colW, 'Antipasti', [
    { name: 'Bruschetta al Pomodoro', price: '9', desc: 'Grilled bread, heirloom tomato, basil, garlic' },
    { name: 'Burrata', price: '14', desc: 'Creamy burrata, roasted peppers, olive oil' },
    { name: 'Calamari Fritti', price: '13', desc: 'Crispy squid, lemon aioli' },
  ]);
  const p = menuSection(left, a.bottom + 26, colW, 'Primi', [
    { name: 'Tagliatelle al Ragù', price: '19', desc: 'Slow-cooked beef and pork ragù' },
    { name: 'Cacio e Pepe', price: '17', desc: 'Tonnarelli, pecorino romano, black pepper' },
    { name: 'Risotto ai Funghi', price: '21', desc: 'Carnaroli rice, wild mushrooms, parmigiano' },
    { name: 'Gnocchi al Pesto', price: '18', desc: 'Potato gnocchi, basil pesto, pine nuts' },
  ]);
  const s = menuSection(right, 240, colW, 'Secondi', [
    { name: 'Pollo al Mattone', price: '24', desc: 'Brick-pressed chicken, rosemary potatoes' },
    { name: 'Branzino', price: '29', desc: 'Whole sea bass, capers, lemon' },
    { name: 'Bistecca', price: '38', desc: 'Grilled ribeye, rocket, parmigiano' },
  ]);
  const d = menuSection(right, s.bottom + 26, colW, 'Dolci', [
    { name: 'Tiramisù', price: '9', desc: 'Espresso, mascarpone, cocoa' },
    { name: 'Panna Cotta', price: '8', desc: 'Vanilla cream, berry compote' },
  ]);
  const boxY = Math.max(p.bottom, d.bottom) + 24;
  return makeDoc({
    name: 'Restaurant menu',
    preset: 'a4',
    swatches: ['#2b2118', '#f7f1e8', '#a4161a', '#335c43', '#8c7b6b', '#e9dcc9'],
    pages: [
      {
        background: '$1',
        frames: [
          text(60, 58, W - 120, 20, 'TRATTORIA', { style: 'label', size: 12, ls: 600, color: '$2', align: 'center' }),
          text(60, 80, W - 120, 84, 'Nonna Lucia', { family: F.elegant, italic: true, size: 66, color: '$0', align: 'center', name: 'Restaurant name' }),
          text(60, 168, W - 120, 20, 'HANDMADE PASTA  ·  WOOD-FIRED  ·  SINCE 1987', { size: 11, ls: 300, color: '$4', align: 'center' }),
          line(60, 210, W / 2 - 80, '$0', 1),
          diamond(W / 2 - 7, 203, 14, 14, '$2'),
          line(W / 2 + 20, 210, W / 2 - 80, '$0', 1),
          ...a.frames,
          ...p.frames,
          ...s.frames,
          ...d.frames,
          rect(left, boxY, W - 120, 120, '$5', { radius: 10, name: 'Feast box' }),
          text(left + 24, boxY, W - 168, 120, 'Family-style feast for four — 95\nA selection of antipasti, two pastas, a main course and dessert to share.', {
            family: F.serif,
            size: 15,
            lh: 1.55,
            color: '$0',
            align: 'center',
            valign: 'middle',
          }),
          rect(-12, 1040, W + 24, 95, '$3', { name: 'Footer' }),
          text(40, 1040, W - 80, 82, 'Via Roma 21  ·  Open Tue–Sun 12–23  ·  Reservations (555) 018-4400', {
            size: 12,
            ls: 80,
            color: '$1',
            align: 'center',
            valign: 'middle',
          }),
        ],
      },
    ],
  });
}

export const PRINT_TEMPLATES: TemplateDef[] = [
  { id: 'event-poster', name: 'Event poster', category: 'print', description: 'Retro sunset festival poster, 18 × 24 in', build: eventPoster },
  { id: 'sale-flyer', name: 'Sale flyer', category: 'print', description: 'Bold weekend sale flyer with coupon', build: saleFlyer },
  { id: 'business-card', name: 'Business card', category: 'print', description: 'Two-sided card, 85 × 55 mm', build: businessCard },
  { id: 'invitation', name: 'Invitation', category: 'print', description: 'Elegant wedding invitation, 5 × 7 in', build: invitation },
  { id: 'certificate', name: 'Certificate', category: 'print', description: 'Certificate of achievement, Letter landscape', build: certificate },
  { id: 'restaurant-menu', name: 'Restaurant menu', category: 'print', description: 'Two-column trattoria menu, A4', build: restaurantMenu },
  { id: 'photo-flyer', name: 'Open house flyer', category: 'print', description: 'Real estate flyer with photo grid, Letter', build: openHouse },
];

/* ------------------------------ Open house flyer ---------------------------- */

function openHouse() {
  const W = 816;
  return makeDoc({
    name: 'Open house flyer',
    preset: 'letter',
    swatches: ['#1e293b', '#ffffff', '#0d9488', '#334155', '#94a3b8', '#ccfbf1'],
    pages: [
      {
        background: '$1',
        frames: [
          image(0, 0, W, 500, '$4', { name: 'Hero photo' }),
          rect(48, 420, 360, 120, '$2', { name: 'Label box' }),
          text(72, 420, 320, 120, 'OPEN HOUSE\nSunday 1 – 4 PM', { size: 30, weight: 800, lh: 1.15, color: '$1', valign: 'middle' }),
          text(48, 568, 500, 50, '24 Maple Crescent', { size: 36, weight: 700, color: '$0' }),
          text(48, 616, 500, 30, 'Lakeview, Springfield', { size: 18, color: '$4' }),
          text(600, 568, 168, 50, '$685,000', { size: 32, weight: 800, color: '$2', align: 'right' }),
          rect(48, 668, 720, 1, '$4', { opacity: 0.5 }),
          text(48, 684, 160, 60, '4\nBedrooms', { size: 15, lh: 1.3, color: '$0', align: 'center', valign: 'middle' }),
          text(228, 684, 160, 60, '3\nBathrooms', { size: 15, lh: 1.3, color: '$0', align: 'center', valign: 'middle' }),
          text(408, 684, 160, 60, '2,450\nSq ft', { size: 15, lh: 1.3, color: '$0', align: 'center', valign: 'middle' }),
          text(588, 684, 180, 60, '0.3\nAcre lot', { size: 15, lh: 1.3, color: '$0', align: 'center', valign: 'middle' }),
          rect(48, 760, 720, 1, '$4', { opacity: 0.5 }),
          image(48, 784, 232, 150, '$4', { radius: 8 }),
          image(292, 784, 232, 150, '$4', { radius: 8 }),
          image(536, 784, 232, 150, '$4', { radius: 8 }),
          rect(0, 960, W, 96, '$3'),
          ellipse(48, 976, 64, 64, '$4'),
          text(128, 976, 400, 64, 'Dana Whitfield, Realtor\n(555) 019-3321  ·  dana@homes.example', { size: 14, lh: 1.5, color: '$1', valign: 'middle' }),
          text(560, 976, 208, 64, 'BRIGHT\nHOMES', { size: 18, weight: 800, ls: 300, lh: 1.1, color: '$5', align: 'right', valign: 'middle' }),
        ],
      },
    ],
  });
}
