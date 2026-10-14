import type { MenuEntry } from '../../components/ui';
import type { TFunction } from '../../core/i18n';
import { isMac } from '../../core/platform';
import type { EditActions } from './actions';
import type { EditorCore } from './editor';
import type { FileActions } from './fileActions';

const mod = isMac ? '⌘' : 'Ctrl+';

export interface MenuHandlers {
  newDoc: () => void;
  exportDialog: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  zoomFit: () => void;
  zoomAll: () => void;
  zoom100: () => void;
  zoomSelection: () => void;
  aiGenerate: () => void;
  aiLogos: () => void;
  aiRecolor: () => void;
  aiName: () => void;
}

export function buildMenus(t: TFunction, core: EditorCore, actions: EditActions, files: FileActions, h: MenuHandlers): { label: string; entries: () => MenuEntry[] }[] {
  const hasSel = core.selection.length > 0;
  return [
    {
      label: t('File'),
      entries: () => [
        { label: t('New…'), shortcut: `${mod}N`, onClick: h.newDoc },
        { label: t('Open…'), shortcut: `${mod}O`, onClick: () => void files.open() },
        { label: t('Place SVG or image…'), onClick: () => void files.place() },
        { type: 'separator' },
        { label: t('Save'), shortcut: `${mod}S`, onClick: () => void files.save() },
        { label: t('Save as…'), shortcut: `${mod}Shift+S`, onClick: () => void files.save(true) },
        { type: 'separator' },
        { label: t('Export…'), shortcut: `${mod}E`, onClick: h.exportDialog },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), shortcut: `${mod}Z`, disabled: !core.history.canUndo, onClick: core.history.undo },
        { label: t('Redo'), shortcut: isMac ? '⌘⇧Z' : 'Ctrl+Y', disabled: !core.history.canRedo, onClick: core.history.redo },
        { type: 'separator' },
        { label: t('Cut'), shortcut: `${mod}X`, disabled: !hasSel, onClick: h.cut },
        { label: t('Copy'), shortcut: `${mod}C`, disabled: !hasSel, onClick: h.copy },
        { label: t('Paste'), shortcut: `${mod}V`, onClick: h.paste },
        { label: t('Duplicate'), shortcut: `${mod}D`, disabled: !hasSel, onClick: actions.duplicate },
        { label: t('Delete'), shortcut: 'Del', disabled: !hasSel, onClick: actions.deleteSelection },
        { type: 'separator' },
        { label: t('Select all'), shortcut: `${mod}A`, onClick: actions.selectAll },
        { label: t('Deselect'), shortcut: `${mod}Shift+A`, onClick: actions.deselect },
      ],
    },
    {
      label: t('Object'),
      entries: () => [
        { label: t('Group'), shortcut: `${mod}G`, disabled: !hasSel, onClick: actions.group },
        { label: t('Ungroup'), shortcut: `${mod}Shift+G`, disabled: !hasSel, onClick: actions.ungroup },
        {
          label: t('Arrange'),
          disabled: !hasSel,
          submenu: [
            { label: t('Bring to front'), shortcut: `${mod}Shift+]`, onClick: () => actions.arrange('front') },
            { label: t('Bring forward'), shortcut: `${mod}]`, onClick: () => actions.arrange('forward') },
            { label: t('Send backward'), shortcut: `${mod}[`, onClick: () => actions.arrange('backward') },
            { label: t('Send to back'), shortcut: `${mod}Shift+[`, onClick: () => actions.arrange('back') },
          ],
        },
        {
          label: t('Align'),
          disabled: !hasSel,
          submenu: [
            { label: t('Align left'), onClick: () => actions.align('left') },
            { label: t('Align horizontal centers'), onClick: () => actions.align('hcenter') },
            { label: t('Align right'), onClick: () => actions.align('right') },
            { type: 'separator' },
            { label: t('Align top'), onClick: () => actions.align('top') },
            { label: t('Align vertical centers'), onClick: () => actions.align('vcenter') },
            { label: t('Align bottom'), onClick: () => actions.align('bottom') },
            { type: 'separator' },
            { label: t('Align to artboard'), checked: core.viewOpts.alignTo === 'artboard', onClick: () => core.setViewOpts({ alignTo: core.viewOpts.alignTo === 'artboard' ? 'selection' : 'artboard' }) },
          ],
        },
        {
          label: t('Distribute'),
          disabled: core.selection.length < 3,
          submenu: [
            { label: t('Distribute horizontally'), onClick: () => actions.distribute('h') },
            { label: t('Distribute vertically'), onClick: () => actions.distribute('v') },
          ],
        },
        {
          label: t('Transform'),
          disabled: !hasSel,
          submenu: [
            { label: t('Flip horizontal'), onClick: () => actions.flip('h') },
            { label: t('Flip vertical'), onClick: () => actions.flip('v') },
            { label: t('Rotate 90° right'), onClick: () => actions.rotate(90) },
            { label: t('Rotate 90° left'), onClick: () => actions.rotate(-90) },
            { label: t('Rotate 180°'), onClick: () => actions.rotate(180) },
          ],
        },
        { type: 'separator' },
        { label: t('Lock'), shortcut: `${mod}2`, disabled: !hasSel, onClick: () => actions.setLocked(true) },
        { label: t('Unlock all'), shortcut: `${mod}Alt+2`, onClick: actions.unlockAll },
        { label: t('Hide'), shortcut: `${mod}3`, disabled: !hasSel, onClick: actions.hide },
        { label: t('Show all'), shortcut: `${mod}Alt+3`, onClick: actions.showAll },
        { type: 'separator' },
        { label: t('Convert to path'), disabled: !hasSel, onClick: actions.convertToPath },
        { label: t('Outline stroke'), disabled: !hasSel, onClick: actions.outlineStroke },
        { label: t('Put text on path'), disabled: core.selection.length < 2, onClick: actions.textOnPath },
        { label: t('Release text from path'), disabled: !hasSel, onClick: actions.releaseTextPath },
      ],
    },
    {
      label: t('Pathfinder'),
      entries: () => [
        { label: t('Unite'), disabled: !hasSel, onClick: () => actions.pathfinder('unite') },
        { label: t('Minus front'), disabled: core.selection.length < 2, onClick: () => actions.pathfinder('minus-front') },
        { label: t('Intersect'), disabled: core.selection.length < 2, onClick: () => actions.pathfinder('intersect') },
        { label: t('Exclude'), disabled: core.selection.length < 2, onClick: () => actions.pathfinder('exclude') },
      ],
    },
    {
      label: t('View'),
      entries: () => [
        { label: t('Zoom in'), shortcut: `${mod}+`, onClick: () => core.viewport.zoomIn() },
        { label: t('Zoom out'), shortcut: `${mod}-`, onClick: () => core.viewport.zoomOut() },
        { label: t('Fit artboard'), shortcut: `${mod}0`, onClick: h.zoomFit },
        { label: t('Fit all artboards'), onClick: h.zoomAll },
        { label: t('Zoom to selection'), disabled: !hasSel, onClick: h.zoomSelection },
        { label: t('Actual size'), shortcut: `${mod}1`, onClick: h.zoom100 },
        { type: 'separator' },
        { label: t('Outline mode'), checked: core.viewOpts.outline, onClick: () => core.setViewOpts({ outline: !core.viewOpts.outline }) },
        { label: t('Show grid'), shortcut: `${mod}'`, checked: core.viewOpts.grid, onClick: () => core.setViewOpts({ grid: !core.viewOpts.grid }) },
        { label: t('Snap to grid'), checked: core.viewOpts.snapToGrid, onClick: () => core.setViewOpts({ snapToGrid: !core.viewOpts.snapToGrid }) },
        { label: t('Smart guides'), checked: core.viewOpts.smartGuides, onClick: () => core.setViewOpts({ smartGuides: !core.viewOpts.smartGuides }) },
      ],
    },
    {
      label: t('AI'),
      entries: () => [
        { label: t('Generate artwork…'), onClick: h.aiGenerate },
        { label: t('Logo ideas…'), onClick: h.aiLogos },
        { label: t('Recolor artwork…'), onClick: h.aiRecolor },
        { label: t('Name layers'), onClick: h.aiName },
      ],
    },
  ];
}

/** Right-click menu on the canvas. */
export function contextEntries(t: TFunction, core: EditorCore, actions: EditActions, h: MenuHandlers, canPaste: boolean): MenuEntry[] {
  const hasSel = core.selection.length > 0;
  if (!hasSel) {
    return [
      { label: t('Paste'), disabled: !canPaste, onClick: h.paste },
      { label: t('Select all'), onClick: actions.selectAll },
      { type: 'separator' },
      { label: t('Fit artboard'), onClick: h.zoomFit },
    ];
  }
  return [
    { label: t('Cut'), onClick: h.cut },
    { label: t('Copy'), onClick: h.copy },
    { label: t('Paste'), disabled: !canPaste, onClick: h.paste },
    { label: t('Duplicate'), onClick: actions.duplicate },
    { label: t('Delete'), onClick: actions.deleteSelection },
    { type: 'separator' },
    { label: t('Group'), onClick: actions.group },
    { label: t('Ungroup'), onClick: actions.ungroup },
    {
      label: t('Arrange'),
      submenu: [
        { label: t('Bring to front'), onClick: () => actions.arrange('front') },
        { label: t('Bring forward'), onClick: () => actions.arrange('forward') },
        { label: t('Send backward'), onClick: () => actions.arrange('backward') },
        { label: t('Send to back'), onClick: () => actions.arrange('back') },
      ],
    },
    {
      label: t('Pathfinder'),
      submenu: [
        { label: t('Unite'), onClick: () => actions.pathfinder('unite') },
        { label: t('Minus front'), onClick: () => actions.pathfinder('minus-front') },
        { label: t('Intersect'), onClick: () => actions.pathfinder('intersect') },
        { label: t('Exclude'), onClick: () => actions.pathfinder('exclude') },
      ],
    },
    { type: 'separator' },
    { label: t('Lock'), onClick: () => actions.setLocked(true) },
    { label: t('Hide'), onClick: actions.hide },
    { label: t('Convert to path'), onClick: actions.convertToPath },
  ];
}
