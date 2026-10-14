import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button, Modal, toast } from '../../components/ui';
import { saveFile } from '../../core/platform';
import { useT } from '../../core/i18n';
import { slugify, toCssVariables, toGpl, toJson, toScss, toTailwind, writeAse, type PaletteData } from './io';
import { renderPalettePng } from './render';
import { copyText } from './widgets';

type FormatId = 'css' | 'scss' | 'json' | 'tailwind' | 'ase' | 'gpl' | 'png';

interface Format {
  id: FormatId;
  label: string;
  description: string;
  ext: string;
  text?: (p: PaletteData) => string;
}

const FORMATS: Format[] = [
  { id: 'css', label: 'CSS variables', description: 'Custom properties for any website', ext: 'css', text: (p) => toCssVariables(p) },
  { id: 'scss', label: 'SCSS', description: 'Sass variables and a color map', ext: 'scss', text: toScss },
  { id: 'json', label: 'JSON', description: 'Names, HEX, RGB, HSL and HSB values', ext: 'json', text: toJson },
  { id: 'tailwind', label: 'Tailwind CSS', description: 'Config snippet (v3) and @theme block (v4)', ext: 'js', text: toTailwind },
  { id: 'ase', label: 'Adobe Swatch Exchange', description: '.ase for Photoshop, Illustrator, InDesign', ext: 'ase' },
  { id: 'gpl', label: 'GIMP / Inkscape palette', description: '.gpl, also used by Krita and Aseprite', ext: 'gpl', text: toGpl },
  { id: 'png', label: 'PNG swatch image', description: 'Swatches with names and values', ext: 'png' },
];

/** Export the palette in every supported format (save or copy). */
export function ExportModal({ palette, onClose }: { palette: PaletteData; onClose: () => void }) {
  const t = useT();
  const [active, setActive] = useState<FormatId>('css');
  const format = FORMATS.find((f) => f.id === active) ?? FORMATS[0];
  const base = slugify(palette.name || 'palette', 'palette');

  const save = async (f: Format) => {
    try {
      let data: Blob;
      if (f.id === 'ase') data = new Blob([writeAse(palette) as BlobPart], { type: 'application/octet-stream' });
      else if (f.id === 'png') data = await renderPalettePng(palette.name, palette.colors);
      else data = new Blob([f.text!(palette)], { type: 'text/plain' });
      const result = await saveFile(data, { suggestedName: `${base}.${f.ext}`, filters: [{ name: t(f.label), extensions: [f.ext] }] });
      if (result) toast.success(t('Exported {format}', { format: t(f.label) }));
    } catch (error) {
      toast.error(t('Export failed'), error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Modal title={t('Export palette')} onClose={onClose} wide>
      <div className="co-export">
        <div className="co-export-list" role="listbox">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" role="option" aria-selected={f.id === active} className={`co-export-item ${f.id === active ? 'active' : ''}`} onClick={() => setActive(f.id)}>
              <strong>{t(f.label)}</strong>
              <span className="faint">{t(f.description)}</span>
            </button>
          ))}
        </div>
        <div className="co-export-preview">
          {format.text ? (
            <pre className="code-block co-code">{format.text(palette)}</pre>
          ) : (
            <div className="co-export-swatches">
              {palette.colors.map((c, i) => (
                <span key={i} style={{ background: c.hex }} title={c.hex} />
              ))}
              <p className="muted">{format.id === 'ase' ? t('Binary file with RGB process colors, grouped under the palette name.') : t('A PNG image (2× resolution) of the swatches with their names and values.')}</p>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {format.text && (
              <Button icon={Copy} onClick={() => void copyText(format.text!(palette), t(format.label))}>
                {t('Copy')}
              </Button>
            )}
            <Button variant="primary" icon={Download} onClick={() => void save(format)}>
              {t('Save .{ext}', { ext: format.ext })}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
