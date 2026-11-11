/** Tiny HTML templating: every interpolated value is escaped unless wrapped in raw(). */
export class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}
export const raw = (value: string) => new Raw(value);

export function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type Part = unknown | Raw | Part[];
const render = (v: Part): string =>
  Array.isArray(v) ? v.map(render).join("") : v instanceof Raw ? v.value : v === false || v == null ? "" : escape(v);

export function html(strings: TemplateStringsArray, ...values: Part[]): Raw {
  return new Raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}
