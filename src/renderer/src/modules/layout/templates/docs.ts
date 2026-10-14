import type { Frame } from '../types';
import { F, image, line, makeDoc, rect, table, text, type TemplateDef } from './kit';

/* --------------------------------- Resume --------------------------------- */

function resume() {
  const H = 1122.5;
  const mainX = 305;
  const mainW = 428;
  const skills: [string, number][] = [
    ['Product strategy', 0.95],
    ['User research', 0.85],
    ['Prototyping', 0.8],
    ['Data analysis (SQL)', 0.7],
    ['Team leadership', 0.9],
  ];
  const skillFrames: Frame[] = skills.flatMap(([name, level], i) => {
    const y = 432 + i * 44;
    return [
      text(40, y, 185, 18, name, { size: 12, color: '$1' }),
      rect(40, y + 22, 185, 5, '$4', { radius: 3, opacity: 0.35 }),
      rect(40, y + 22, 185 * level, 5, '$5', { radius: 3 }),
    ];
  });
  const jobs = [
    {
      title: 'Senior Product Manager — Brightwave',
      meta: '2022 – Present  ·  Austin, TX',
      body: 'Lead a cross-functional team of 14 building analytics for 3,000+ retail stores. Shipped a forecasting product that cut stock-outs by 22%.',
    },
    {
      title: 'Product Manager — Fieldnote',
      meta: '2019 – 2022  ·  Remote',
      body: 'Owned the mobile app roadmap from 0 to 250k monthly users. Introduced continuous discovery and weekly customer interviews.',
    },
    {
      title: 'UX Researcher — Northlight Labs',
      meta: '2016 – 2019  ·  Denver, CO',
      body: 'Planned and ran 120+ usability studies; built the research repository used by six product teams.',
    },
  ];
  const jobFrames: Frame[] = jobs.flatMap((j, i) => {
    const y = 330 + i * 128;
    return [
      text(mainX, y, mainW, 24, j.title, { style: 'h2', name: 'Job title' }),
      text(mainX, y + 26, mainW, 18, j.meta, { style: 'caption' }),
      text(mainX, y + 50, mainW, 66, j.body, { style: 'body' }),
    ];
  });
  return makeDoc({
    name: 'Resume',
    preset: 'a4',
    swatches: ['#1f2933', '#ffffff', '#2563eb', '#0f172a', '#64748b', '#93c5fd'],
    styles: {
      h2: { fontSize: 15.5, fontWeight: 700, color: '$0', spaceAfter: 0 },
      caption: { fontSize: 11.5, italic: false, color: '$2', fontWeight: 600 },
      body: { fontSize: 12.5, lineHeight: 1.55, color: '$0', spaceAfter: 6 },
      label: { fontSize: 11, color: '$5', letterSpacing: 250 },
    },
    pages: [
      {
        background: '$1',
        frames: [
          rect(-12, -12, 277, H + 24, '$3', { name: 'Sidebar' }),
          image(62, 56, 140, 140, '$4', { radius: 70, name: 'Photo', stroke: '$5', sw: 3 }),
          text(40, 232, 185, 18, 'CONTACT', { style: 'label' }),
          text(40, 258, 200, 110, '+1 (555) 013-7788\nsam.rivera@mail.example\nlinkedin.com/in/samrivera\nAustin, Texas', {
            size: 12,
            lh: 1.75,
            color: '$1',
          }),
          text(40, 400, 185, 18, 'SKILLS', { style: 'label' }),
          ...skillFrames,
          text(40, 680, 185, 18, 'LANGUAGES', { style: 'label' }),
          text(40, 706, 200, 70, 'English — native\nSpanish — fluent\nPortuguese — conversational', { size: 12, lh: 1.75, color: '$1' }),
          text(40, 800, 185, 18, 'INTERESTS', { style: 'label' }),
          text(40, 826, 200, 64, 'Cycling, analog photography and community gardening.', { size: 12, lh: 1.6, color: '$1' }),
          text(mainX, 56, mainW, 52, 'SAM RIVERA', { style: 'title', size: 40, weight: 800, ls: 60, color: '$0' }),
          text(mainX, 110, mainW, 28, 'Product Manager', { size: 18, weight: 600, color: '$2' }),
          text(
            mainX,
            152,
            mainW,
            100,
            'Product manager with nine years of experience turning research into products people love. I combine data, empathy and a bias for shipping to grow products and the teams behind them.',
            { style: 'body', color: '$4' },
          ),
          text(mainX, 280, mainW, 20, 'EXPERIENCE', { style: 'label', color: '$2' }),
          line(mainX, 306, mainW, '$5', 2),
          ...jobFrames,
          text(mainX, 734, mainW, 20, 'EDUCATION', { style: 'label', color: '$2' }),
          line(mainX, 760, mainW, '$5', 2),
          text(mainX, 784, mainW, 24, 'MBA — University of Texas at Austin', { style: 'h2' }),
          text(mainX, 810, mainW, 18, '2014 – 2016', { style: 'caption' }),
          text(mainX, 846, mainW, 24, 'B.A. Psychology — University of Colorado', { style: 'h2' }),
          text(mainX, 872, mainW, 18, '2010 – 2014', { style: 'caption' }),
          text(mainX, 920, mainW, 20, 'CERTIFICATIONS', { style: 'label', color: '$2' }),
          line(mainX, 946, mainW, '$5', 2),
          text(mainX, 966, mainW, 60, 'Certified Scrum Product Owner (2021)\nGoogle Data Analytics Certificate (2020)', { style: 'body' }),
        ],
      },
    ],
  });
}

/* -------------------------------- Newsletter -------------------------------- */

const STORY = [
  'After two years of planning, fundraising and more than a few muddy Saturdays, the Riverside Community Garden officially opened its gates last weekend. More than three hundred neighbors came to celebrate, tour the raised beds and sample soup made from the first harvest of winter greens.',
  'The project started with a simple question at a neighborhood meeting: what would it take to turn the empty lot behind the library into something everyone could use? A small group of volunteers formed a committee, met with the city and began collecting donations of tools, seeds and lumber.',
  '“We didn’t want a garden that belonged to a few people,” said committee chair Lucia Ortega. “We wanted a place where kids, retirees and new families would all feel welcome, whether they know anything about plants or not.”',
  'The garden now has forty-two raised beds, eight of them built at wheelchair height, along with a tool shed, a rain-water collection system and a shaded seating area. Twelve beds are reserved for the elementary school next door, where teachers plan to run science lessons outdoors this spring.',
  'Families can rent a bed for the season for a small fee, and anyone can join the open volunteer mornings on the first and third Saturday of each month. No experience is needed: volunteers learn composting, planting and watering from neighbors who have been gardening for decades.',
  'Local businesses helped make the opening possible. The hardware store on Elm Street donated paint and hinges, the bakery supplied bread for the celebration and a landscaping company lent a small excavator to level the ground.',
  'The committee is already planning the next phase: a pollinator meadow along the river path and a small greenhouse so seedlings can be started in late winter. Fundraising for the greenhouse begins at the spring fair in May.',
  'Ortega says the best part has been watching strangers become friends. “Last month a retired teacher spent an entire morning showing two teenagers how to plant garlic. That is exactly what we hoped would happen here.”',
  'To reserve a bed or sign up as a volunteer, visit the garden shed during open hours or email the committee. Seeds from the seed library are free for every resident.',
].join('\n');

function newsletter() {
  const W = 816;
  const first = text(48, 652, 470, 336, STORY, { style: 'body', columns: 2, gap: 20, name: 'Article (page 1)' });
  const second = text(48, 82, 720, 290, '', { style: 'body', columns: 3, gap: 20, name: 'Article (continued)' });
  first.nextId = second.id;
  return makeDoc({
    name: 'Newsletter',
    preset: 'letter',
    swatches: ['#1b1b1f', '#ffffff', '#d62828', '#003049', '#6c757d', '#fcbf49'],
    styles: {
      body: { fontFamily: F.serif, fontSize: 12.5, lineHeight: 1.5, spaceAfter: 7, align: 'justify' },
      h1: { fontFamily: F.elegant, fontSize: 38, fontWeight: 700, lineHeight: 1.1 },
      h2: { fontFamily: F.elegant, fontSize: 22, fontWeight: 700, lineHeight: 1.2 },
      quote: { fontFamily: F.elegant, fontSize: 22, lineHeight: 1.35, color: '$2' },
    },
    master: [
      line(48, 1012, 720, '$4', 0.75),
      text(48, 1020, 400, 18, 'The Community Post  ·  Spring 2026', { size: 9, color: '$4', name: 'Footer' }),
      text(468, 1020, 300, 18, 'Page {page} of {pages}', { size: 9, color: '$4', align: 'right', name: 'Page number' }),
    ],
    pages: [
      {
        background: '$1',
        frames: [
          rect(-12, -12, W + 24, 162, '$3', { name: 'Masthead' }),
          text(48, 40, 720, 62, 'THE COMMUNITY POST', { family: F.elegant, size: 50, weight: 700, ls: 20, color: '$1' }),
          text(48, 106, 720, 20, 'Spring 2026  ·  Issue 12  ·  Free', { style: 'label', size: 11, ls: 200, color: '$5' }),
          text(48, 176, 720, 92, 'Riverside garden opens to the whole neighborhood', { style: 'h1', color: '$0' }),
          text(48, 272, 720, 46, 'After two years of volunteer work, the new community garden welcomes families every weekend.', {
            style: 'subtitle',
            size: 16,
            italic: true,
            color: '$4',
          }),
          image(48, 330, 720, 280, '$4', { name: 'Lead photo' }),
          text(48, 616, 720, 20, 'Volunteers planting the first beds in March. Photo: L. Ortega', { style: 'caption' }),
          first,
          rect(542, 652, 226, 336, '$5', { opacity: 0.18, radius: 6, name: 'Sidebar' }),
          text(560, 670, 190, 20, 'IN THIS ISSUE', { style: 'label', color: '$2' }),
          text(560, 700, 190, 280, '• Garden opens to all — page 1\n• Robotics team takes the regional title — page 2\n• Spring events calendar — page 2\n• Volunteer spotlight — page 2', {
            size: 13,
            lh: 1.45,
            after: 10,
            color: '$0',
          }),
        ],
      },
      {
        background: '$1',
        frames: [
          text(48, 48, 720, 22, 'GARDEN  ·  CONTINUED FROM PAGE 1', { style: 'label', color: '$2' }),
          second,
          text(48, 396, 720, 32, 'Spring events', { style: 'h2' }),
          table(
            48,
            436,
            720,
            200,
            [
              ['Date', 'Event', 'Where'],
              ['Sat, April 4', 'Seed swap & potluck', 'Garden shed'],
              ['Sat, April 18', 'Kids’ planting morning', 'Beds 3 – 6'],
              ['Sat, May 2', 'Composting workshop', 'Pavilion'],
              ['Sun, May 16', 'Spring fair & greenhouse fundraiser', 'Riverside Park'],
            ],
            { fontFamily: F.sans, fontSize: 13, headerFill: '$3', headerColor: '$1', bandFill: 'rgba(252, 191, 73, 0.18)', stroke: '#d9d9de', strokeWidth: 1, cellPadding: 8 },
          ),
          rect(48, 672, 4, 150, '$2', { name: 'Quote bar' }),
          text(68, 668, 320, 160, '“It’s the first place in town where everybody just shows up and helps.”\n— Lucia Ortega', {
            style: 'quote',
            after: 10,
          }),
          text(420, 668, 348, 58, 'Robotics team takes the regional title', { style: 'h2' }),
          text(
            420,
            732,
            348,
            100,
            'The Lincoln Elementary robotics club beat twenty-three teams at the regional championship with a robot that sorts recycling. They now head to the state finals in June.',
            { style: 'body', size: 12 },
          ),
          image(48, 852, 160, 136, '$4', { radius: 8, name: 'Volunteer photo' }),
          text(228, 852, 540, 26, 'Volunteer spotlight: Mr. Abebe', { style: 'h2', size: 18 }),
          text(
            228,
            882,
            540,
            106,
            'A retired chemistry teacher, Mr. Abebe runs the compost station every Saturday and has taught more than fifty neighbors how to turn kitchen scraps into rich soil.',
            { style: 'body', size: 12 },
          ),
        ],
      },
    ],
  });
}

export const DOC_TEMPLATES: TemplateDef[] = [
  { id: 'resume', name: 'Resume / CV', category: 'print', description: 'Modern resume with sidebar and skill bars, A4', build: resume },
  { id: 'newsletter', name: 'Newsletter', category: 'print', description: 'Two-page newsletter with threaded article, table and page numbers', build: newsletter },
];

