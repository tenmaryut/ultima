/**
 * AcroForm support with pdf-lib: detecting fields (with their widgets' positions) and
 * writing values back on save.
 */
import {
  PDFBool,
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFForm,
} from 'pdf-lib';
import type { FieldDef, FieldType, FieldValue } from './types';

function fieldType(field: PDFField): FieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionlist';
  if (field instanceof PDFSignature) return 'signature';
  return 'button';
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Font size from a default appearance string such as "/Helv 12 Tf 0 g" (0 = auto). */
export function daFontSize(da: string | undefined): number {
  const m = /([\d.]+)\s+Tf/.exec(da ?? '');
  const size = m ? parseFloat(m[1]) : 0;
  return Number.isFinite(size) && size > 0 && size < 200 ? size : 0;
}

export function fieldValue(field: PDFField): FieldValue {
  if (field instanceof PDFTextField) return safe(() => field.getText() ?? '', '');
  if (field instanceof PDFCheckBox) return safe(() => field.isChecked(), false);
  if (field instanceof PDFRadioGroup) return safe(() => field.getSelected() ?? '', '');
  if (field instanceof PDFDropdown) return safe(() => field.getSelected()[0] ?? '', '');
  if (field instanceof PDFOptionList) return safe(() => field.getSelected(), [] as string[]);
  return '';
}

/** Reads all fields of a document (fully qualified names, widgets with page index). */
export function detectFields(doc: PDFDocument): { defs: FieldDef[]; values: Record<string, FieldValue> } {
  const defs: FieldDef[] = [];
  const values: Record<string, FieldValue> = {};
  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return { defs, values };
  }
  const pages = doc.getPages();
  const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  for (const field of safe(() => form.getFields(), [] as PDFField[])) {
    const name = safe(() => field.getName(), '');
    if (!name) continue;
    const type = fieldType(field);
    let options: string[] = [];
    if (field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList) {
      options = safe(() => field.getOptions(), [] as string[]);
    }
    const widgets = safe(() => field.acroField.getWidgets(), []).flatMap((w, i) => {
      const r = safe(() => w.getRectangle(), null);
      if (!r || r.width <= 0 || r.height <= 0) return [];
      let idx: number | undefined;
      const P = safe(() => w.P(), undefined);
      if (P) idx = pageIndex.get(P.toString());
      if (idx === undefined) {
        const ref = doc.context.getObjectRef(w.dict);
        const page = ref ? doc.findPageForAnnotationRef(ref) : undefined;
        if (page) idx = pageIndex.get(page.ref.toString());
      }
      if (idx === undefined) return [];
      let option: string | undefined;
      if (field instanceof PDFRadioGroup) option = options[i] ?? safe(() => w.getOnValue()?.decodeText(), undefined);
      if (field instanceof PDFCheckBox) option = safe(() => w.getOnValue()?.decodeText(), undefined);
      return [{ srcIndex: idx, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, option }];
    });
    defs.push({
      name,
      type,
      options,
      multiline: field instanceof PDFTextField ? safe(() => field.isMultiline(), false) : false,
      multiSelect: field instanceof PDFOptionList ? safe(() => field.isMultiselect(), false) : false,
      editable: field instanceof PDFDropdown ? safe(() => field.isEditable(), false) : false,
      readOnly: safe(() => field.isReadOnly(), false),
      required: safe(() => field.isRequired(), false),
      maxLength: field instanceof PDFTextField ? (safe(() => field.getMaxLength(), undefined) ?? null) : null,
      fontSize: daFontSize(safe(() => field.acroField.getDefaultAppearance(), undefined)),
      widgets,
    });
    values[name] = fieldValue(field);
  }
  return { defs, values };
}

export function valuesEqual(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : a ? [String(a)] : [];
    const y = Array.isArray(b) ? b : b ? [String(b)] : [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return (a ?? '') === (b ?? '');
}

/** Coerces any value (e.g. from the AI) into the right shape for a field. Returns null if invalid. */
export function coerceFieldValue(def: FieldDef, value: unknown): FieldValue | null {
  switch (def.type) {
    case 'text': {
      if (value === null || value === undefined) return '';
      const s = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
      if (s === null) return null;
      const clean = def.multiline ? s : s.replace(/\s*\n\s*/g, ' ');
      return def.maxLength ? clean.slice(0, def.maxLength) : clean;
    }
    case 'checkbox':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') return /^(true|yes|ya|on|1|x|checked|✓|y)$/i.test(value.trim());
      if (typeof value === 'number') return value !== 0;
      return null;
    case 'radio':
    case 'dropdown': {
      if (value === null || value === undefined || value === '') return '';
      const s = String(value).trim();
      const exact = def.options.find((o) => o === s) ?? def.options.find((o) => o.toLowerCase() === s.toLowerCase());
      if (exact) return exact;
      return def.type === 'dropdown' && def.editable ? s : null;
    }
    case 'optionlist': {
      const list = Array.isArray(value) ? value.map(String) : value === null || value === undefined || value === '' ? [] : [String(value)];
      const picked = list
        .map((s) => def.options.find((o) => o.toLowerCase() === s.trim().toLowerCase()))
        .filter((o): o is string => !!o);
      return def.multiSelect ? [...new Set(picked)] : picked.slice(0, 1);
    }
    default:
      return null;
  }
}

/** Writes changed values into the pdf-lib form. Returns names that could not be set. */
export function applyFieldValues(doc: PDFDocument, values: Record<string, FieldValue>, initial: Record<string, FieldValue>): string[] {
  const failed: string[] = [];
  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return Object.keys(values);
  }
  for (const [name, value] of Object.entries(values)) {
    if (valuesEqual(value, initial[name])) continue;
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    try {
      if (field instanceof PDFTextField) {
        const text = String(value ?? '');
        const max = field.getMaxLength();
        field.setText(max ? text.slice(0, max) : text);
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFDropdown) {
        if (typeof value === 'string' && value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFOptionList) {
        const list = Array.isArray(value) ? value : value ? [String(value)] : [];
        if (list.length) field.select(list);
        else field.clear();
      } else if (field instanceof PDFButton || field instanceof PDFSignature) {
        continue;
      }
    } catch {
      failed.push(name);
    }
  }
  return failed;
}

/** Removes fields whose widgets are all on pages that are no longer in the document. */
export function removeOrphanFields(doc: PDFDocument): void {
  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  const refs = new Set(doc.getPages().map((p) => p.ref.toString()));
  for (const field of form.getFields()) {
    try {
      const widgets = field.acroField.getWidgets();
      const alive = widgets.some((w) => {
        const P = w.P();
        if (P) return refs.has(P.toString());
        const ref = doc.context.getObjectRef(w.dict);
        return !!(ref && doc.findPageForAnnotationRef(ref));
      });
      if (!alive) form.acroForm.removeField(field.acroField);
    } catch {
      // leave odd fields alone
    }
  }
}

/** Generates appearances; when the standard font can't write a value, asks viewers to do it. */
export function updateAppearancesSafely(doc: PDFDocument): void {
  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  try {
    form.updateFieldAppearances();
  } catch {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }
}

/** Flattens the form (values become page content). Fields that fail are left interactive. */
export function flattenFormSafely(doc: PDFDocument): void {
  let form: PDFForm;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  try {
    form.flatten();
  } catch {
    // some widgets have no usable appearance: keep those fields, but make them read-only
    for (const field of form.getFields()) {
      try {
        field.enableReadOnly();
      } catch {
        // ignore
      }
    }
  }
}
