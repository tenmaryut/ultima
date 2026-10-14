import type { ToolId } from '../types';
import { bucketTool, gradientTool } from './fill';
import { eyedropperTool, handTool, shapeTool, textTool, zoomTool } from './misc';
import { blurTool, brushTool, cloneTool, dodgeTool, eraserTool, healTool, pencilTool } from './paint';
import { lassoTool, marqueeTool, wandTool } from './select';
import { cropTool } from './crop';
import { moveTool } from './transform';
import type { ToolHandler } from './types';

export const TOOLS: Record<ToolId, ToolHandler> = {
  move: moveTool,
  marquee: marqueeTool,
  lasso: lassoTool,
  wand: wandTool,
  crop: cropTool,
  eyedropper: eyedropperTool,
  heal: healTool,
  clone: cloneTool,
  brush: brushTool,
  pencil: pencilTool,
  eraser: eraserTool,
  bucket: bucketTool,
  gradient: gradientTool,
  dodge: dodgeTool,
  blur: blurTool,
  text: textTool,
  shape: shapeTool,
  hand: handTool,
  zoom: zoomTool,
};
