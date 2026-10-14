import { Download, FilePlus, FolderOpen, ImagePlus, Redo2, Save, Sparkles, Undo2 } from 'lucide-react';
import type { MenuEntry } from '../../components/ui';
import type { TFunction } from '../../core/i18n';
import type { ViewportApi } from '../../core/viewport';
import { isMac } from '../../core/platform';
import * as A from './actions';
import type { PhotoEngine } from './engine';
import { applyPixelOp, autoAdjust } from './pixelActions';
import { startFreeTransform } from './tools/transform';

export type DialogState =
  | { kind: 'new' }
  | { kind: 'imageSize' }
  | { kind: 'canvasSize' }
  | { kind: 'export' }
  | { kind: 'fill' }
  | { kind: 'adjust'; id: string }
  | { kind: 'genfill' }
  | { kind: 'generate' }
  | { kind: 'describe' };

export interface MenuContext {
  t: TFunction;
  engine: PhotoEngine;
  viewport: ViewportApi;
  open: (d: DialogState) => void;
  ai: {
    removeBackground: () => void;
    removeUniform: () => void;
    autoEnhance: () => void;
  };
}

const mod = isMac ? '⌘' : 'Ctrl+';

export function buildMenus(c: MenuContext): { label: string; entries: () => MenuEntry[] }[] {
  const { t, engine, open } = c;
  const has = () => Boolean(engine.doc);
  const sel = () => Boolean(engine.doc?.selection);
  const layer = () => engine.activeLayer();
  const adj = (id: string, label: string, shortcut?: string): MenuEntry => ({ label: t(label), shortcut, disabled: !layer(), onClick: () => open({ kind: 'adjust', id }) });
  const direct = (label: string, fn: () => void, shortcut?: string): MenuEntry => ({ label: t(label), shortcut, disabled: !layer(), onClick: fn });
  return [
    {
      label: t('File'),
      entries: () => [
        { label: t('New…'), icon: FilePlus, shortcut: `${mod}N`, onClick: () => open({ kind: 'new' }) },
        { label: t('Open…'), icon: FolderOpen, shortcut: `${mod}O`, onClick: () => void A.pickAndOpen() },
        { label: t('Place Image…'), icon: ImagePlus, disabled: !has(), onClick: () => void A.pickAndPlace(engine) },
        { type: 'separator' },
        { label: t('Save Project'), icon: Save, shortcut: `${mod}S`, disabled: !has(), onClick: () => void A.saveProject(engine, false) },
        { label: t('Save Project As…'), shortcut: `${mod}Shift+S`, disabled: !has(), onClick: () => void A.saveProject(engine, true) },
        { type: 'separator' },
        { label: t('Export…'), icon: Download, shortcut: `${mod}E`, disabled: !has(), onClick: () => open({ kind: 'export' }) },
        { label: t('Export as PSD'), disabled: !has(), onClick: () => void A.exportPsd(engine) },
        { type: 'separator' },
        { label: t('Close Document'), disabled: !has(), onClick: () => engine.session && void A.closeDocument(engine.session.id) },
      ],
    },
    {
      label: t('Edit'),
      entries: () => [
        { label: t('Undo'), icon: Undo2, shortcut: `${mod}Z`, disabled: !engine.history?.canUndo, onClick: () => engine.history?.undo() },
        { label: t('Redo'), icon: Redo2, shortcut: isMac ? '⌘Shift+Z' : 'Ctrl+Y', disabled: !engine.history?.canRedo, onClick: () => engine.history?.redo() },
        { type: 'separator' },
        { label: t('Cut'), shortcut: `${mod}X`, disabled: !sel(), onClick: () => A.cut(engine) },
        { label: t('Copy'), shortcut: `${mod}C`, disabled: !has(), onClick: () => A.copy(engine, false) },
        { label: t('Copy Merged'), shortcut: `${mod}Shift+C`, disabled: !has(), onClick: () => A.copy(engine, true) },
        { label: t('Paste'), shortcut: `${mod}V`, disabled: !A.internalClipboard(), onClick: () => A.pasteInternal(engine) },
        { label: t('Clear'), shortcut: 'Delete', disabled: !sel(), onClick: () => void A.deleteAction(engine) },
        { type: 'separator' },
        { label: t('Fill…'), shortcut: 'Shift+F5', disabled: !layer(), onClick: () => open({ kind: 'fill' }) },
        { label: t('Fill with Foreground'), shortcut: 'Alt+Backspace', disabled: !layer(), onClick: () => void A.fillAction(engine, engine.store.fg) },
        { label: t('Fill with Background'), shortcut: `${mod}Backspace`, disabled: !layer(), onClick: () => void A.fillAction(engine, engine.store.bg) },
        { type: 'separator' },
        { label: t('Free Transform'), shortcut: `${mod}T`, disabled: !layer(), onClick: () => startFreeTransform(engine) },
        {
          label: t('Transform'),
          disabled: !layer(),
          submenu: [
            { label: t('Flip Horizontal'), onClick: () => A.flipActiveLayer(engine, 'horizontal') },
            { label: t('Flip Vertical'), onClick: () => A.flipActiveLayer(engine, 'vertical') },
          ],
        },
      ],
    },
    {
      label: t('Image'),
      entries: () => [
        {
          label: t('Adjustments'),
          disabled: !layer(),
          submenu: [
            adj('brightnessContrast', 'Brightness/Contrast…'),
            adj('levels', 'Levels…', `${mod}L`),
            adj('curves', 'Curves…', `${mod}M`),
            adj('exposure', 'Exposure…'),
            { type: 'separator' },
            adj('vibrance', 'Vibrance…'),
            adj('hueSaturation', 'Hue/Saturation…', `${mod}U`),
            adj('colorBalance', 'Color Balance…', `${mod}B`),
            adj('blackWhite', 'Black & White…'),
            adj('photoFilter', 'Photo Filter…'),
            { type: 'separator' },
            direct('Invert', () => void applyPixelOp(engine, 'invert', {}, 'Invert'), `${mod}I`),
            adj('posterize', 'Posterize…'),
            adj('threshold', 'Threshold…'),
            direct('Desaturate', () => void applyPixelOp(engine, 'desaturate', {}, 'Desaturate'), `${mod}Shift+U`),
          ],
        },
        { type: 'separator' },
        direct('Auto Tone', () => void autoAdjust(engine, 'tone')),
        direct('Auto Contrast', () => void autoAdjust(engine, 'contrast')),
        direct('Auto Color', () => void autoAdjust(engine, 'color')),
        { type: 'separator' },
        { label: t('Image Size…'), shortcut: `${mod}Alt+I`, disabled: !has(), onClick: () => open({ kind: 'imageSize' }) },
        { label: t('Canvas Size…'), shortcut: `${mod}Alt+C`, disabled: !has(), onClick: () => open({ kind: 'canvasSize' }) },
        {
          label: t('Image Rotation'),
          disabled: !has(),
          submenu: [
            { label: t('180°'), onClick: () => A.rotateImage(engine, 180) },
            { label: t('90° Clockwise'), onClick: () => A.rotateImage(engine, 90) },
            { label: t('90° Counter Clockwise'), onClick: () => A.rotateImage(engine, -90) },
            { label: t('Arbitrary…'), onClick: () => void A.rotateArbitraryPrompt(engine) },
            { type: 'separator' },
            { label: t('Flip Canvas Horizontal'), onClick: () => A.flipImage(engine, 'horizontal') },
            { label: t('Flip Canvas Vertical'), onClick: () => A.flipImage(engine, 'vertical') },
          ],
        },
        { label: t('Crop to Selection'), disabled: !sel(), onClick: () => A.cropToSelection(engine) },
        { label: t('Trim Transparent Pixels'), disabled: !has(), onClick: () => A.trimTransparent(engine) },
      ],
    },
    {
      label: t('Layer'),
      entries: () => [
        { label: t('New Layer'), shortcut: `${mod}Shift+N`, disabled: !has(), onClick: () => A.newLayer(engine) },
        { label: t('New Text Layer'), disabled: !has(), onClick: () => A.newTextLayer(engine) },
        { label: t('Duplicate Layer'), shortcut: `${mod}D`, disabled: !layer(), onClick: () => A.duplicateLayer(engine) },
        { label: t('Delete Layer'), disabled: !layer(), onClick: () => A.deleteLayer(engine) },
        { type: 'separator' },
        {
          label: t('Layer Mask'),
          disabled: !layer(),
          submenu: [
            { label: t('Reveal All'), disabled: Boolean(layer()?.mask), onClick: () => A.maskAction(engine, 'reveal') },
            { label: t('Hide All'), disabled: Boolean(layer()?.mask), onClick: () => A.maskAction(engine, 'hide') },
            { label: t('Reveal Selection'), disabled: Boolean(layer()?.mask) || !sel(), onClick: () => A.maskAction(engine, 'selection') },
            { type: 'separator' },
            { label: t('Invert Mask'), disabled: !layer()?.mask, onClick: () => A.maskAction(engine, 'invert') },
            { label: layer()?.mask?.enabled === false ? t('Enable Mask') : t('Disable Mask'), disabled: !layer()?.mask, onClick: () => A.maskAction(engine, 'toggle') },
            { label: t('Apply Mask'), disabled: !layer()?.mask, onClick: () => A.maskAction(engine, 'apply') },
            { label: t('Delete Mask'), disabled: !layer()?.mask, onClick: () => A.maskAction(engine, 'delete') },
          ],
        },
        { label: t('Rasterize Layer'), disabled: !layer() || layer()?.type === 'raster', onClick: () => void A.rasterizeAction(engine) },
        { type: 'separator' },
        {
          label: t('Arrange'),
          disabled: !layer(),
          submenu: [
            { label: t('Bring to Front'), onClick: () => A.moveLayer(engine, layer()!.id, 'top') },
            { label: t('Bring Forward'), onClick: () => A.moveLayer(engine, layer()!.id, 'up') },
            { label: t('Send Backward'), onClick: () => A.moveLayer(engine, layer()!.id, 'down') },
            { label: t('Send to Back'), onClick: () => A.moveLayer(engine, layer()!.id, 'bottom') },
          ],
        },
        { type: 'separator' },
        { label: t('Merge Down'), disabled: !layer(), onClick: () => A.mergeDownAction(engine) },
        { label: t('Merge Visible'), shortcut: `${mod}Shift+E`, disabled: !has(), onClick: () => A.mergeVisibleAction(engine) },
        { label: t('Flatten Image'), disabled: !has(), onClick: () => void A.flattenAction(engine) },
      ],
    },
    {
      label: t('Select'),
      entries: () => [
        { label: t('All'), shortcut: `${mod}A`, disabled: !has(), onClick: () => A.selectAll(engine) },
        { label: t('Deselect'), shortcut: `${mod}Shift+A`, disabled: !sel(), onClick: () => A.deselect(engine) },
        { label: t('Inverse'), shortcut: `${mod}Shift+I`, disabled: !has(), onClick: () => A.inverseSelection(engine) },
        { type: 'separator' },
        { label: t('Feather…'), disabled: !sel(), onClick: () => void A.modifySelection(engine, 'feather') },
        { label: t('Expand…'), disabled: !sel(), onClick: () => void A.modifySelection(engine, 'expand') },
        { label: t('Contract…'), disabled: !sel(), onClick: () => void A.modifySelection(engine, 'contract') },
        { type: 'separator' },
        { label: t('Select Layer Pixels'), disabled: !layer(), onClick: () => layer() && A.selectPixelsOf(engine, layer()!.id) },
      ],
    },
    {
      label: t('Filter'),
      entries: () => [
        {
          label: t('Blur'),
          disabled: !layer(),
          submenu: [adj('gaussianBlur', 'Gaussian Blur…'), adj('motionBlur', 'Motion Blur…')],
        },
        {
          label: t('Sharpen'),
          disabled: !layer(),
          submenu: [direct('Sharpen', () => void applyPixelOp(engine, 'sharpen', {}, 'Sharpen')), adj('unsharpMask', 'Unsharp Mask…')],
        },
        {
          label: t('Noise'),
          disabled: !layer(),
          submenu: [adj('addNoise', 'Add Noise…'), adj('median', 'Reduce Noise (Median)…')],
        },
        {
          label: t('Stylize'),
          disabled: !layer(),
          submenu: [adj('emboss', 'Emboss…'), direct('Find Edges', () => void applyPixelOp(engine, 'findEdges', {}, 'Find Edges')), adj('oilPaint', 'Oil Paint…'), adj('pixelate', 'Pixelate…')],
        },
        { type: 'separator' },
        adj('vignette', 'Vignette…'),
        adj('grain', 'Film Grain…'),
        adj('highPass', 'High Pass…'),
      ],
    },
    {
      label: t('View'),
      entries: () => [
        { label: t('Zoom In'), shortcut: `${mod}+`, disabled: !has(), onClick: c.viewport.zoomIn },
        { label: t('Zoom Out'), shortcut: `${mod}-`, disabled: !has(), onClick: c.viewport.zoomOut },
        { label: t('Fit on Screen'), shortcut: `${mod}0`, disabled: !has(), onClick: c.viewport.fit },
        { label: t('100%'), shortcut: `${mod}1`, disabled: !has(), onClick: c.viewport.actualSize },
      ],
    },
    {
      label: t('AI'),
      entries: () => [
        { label: t('Remove Background'), icon: Sparkles, disabled: !layer(), onClick: c.ai.removeBackground },
        { label: t('Remove Uniform Background (no AI)'), disabled: !layer(), onClick: c.ai.removeUniform },
        { label: t('Generative Fill…'), disabled: !sel(), onClick: () => open({ kind: 'genfill' }) },
        { label: t('Generate Image…'), onClick: () => open({ kind: 'generate' }) },
        { label: t('Describe / Alt Text…'), disabled: !has(), onClick: () => open({ kind: 'describe' }) },
        { type: 'separator' },
        { label: t('Auto-Enhance'), disabled: !layer(), onClick: c.ai.autoEnhance },
      ],
    },
  ];
}
