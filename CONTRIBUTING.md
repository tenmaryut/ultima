# Contributing to Ultima

Thanks for helping! Ultima is a community project: every tool, translation and bug report counts.
(Bahasa Indonesia: kontribusi dalam bahasa Indonesia juga sangat diterima — issue dan PR boleh ditulis dalam bahasa Indonesia.)

## Ways to help

- **Report bugs** and **request features** with the [issue templates](https://github.com/tenmaryut/ultima/issues/new/choose).
- **Translate**: UI strings live in `src/renderer/src/i18n/id.ts` and in each module's `i18n.ts`.
  The English text is the key, so adding a language means adding one dictionary per file.
- **Improve a tool**: each editor is a self-contained folder in `src/renderer/src/modules/`.
- **Add an AI connection**: one adapter function in `src/main/ai/adapters.ts` plus an entry in
  `src/shared/providers-catalog.ts`.
- **Docs**: everything in `docs/` (English) and `docs/id/` (Indonesian).

## Development setup

```bash
git clone https://github.com/tenmaryut/ultima.git
cd ultima
npm install
npm run dev
```

Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) first — it explains the module contract, the UI kit,
the AI assistant protocol and the security rules.

Before opening a pull request:

```bash
npm run typecheck
npm test
npx electron-vite build
```

## Guidelines

- Keep pull requests focused: one feature or fix per PR, with screenshots for UI changes.
- Strict TypeScript, no `any` unless unavoidable. Pure logic goes in `.ts` files with unit tests.
- All user-visible text goes through `t()` and gets an Indonesian translation.
- Use the CSS variables from `styles/global.css` so both themes work.
- Never call a paid AI API from Ultima, and never read or store credentials of AI tools.
- New dependencies must be MIT/Apache/BSD/ISC/MPL-compatible and worth their size.

By contributing you agree that your contribution is licensed under the MIT license.
