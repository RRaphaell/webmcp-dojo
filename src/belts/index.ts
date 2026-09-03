// Belt roster. Every file in this folder that exports `belt` is a belt; order comes from belt.order.
import type { Belt } from './types'

const modules = import.meta.glob<{ belt?: Belt }>(['./*.ts', '!./types.ts', '!./fixture.ts', '!./index.ts'], { eager: true })

export const belts: Belt[] = Object.values(modules)
  .map((m) => m.belt)
  .filter((b): b is Belt => !!b)
  .sort((a, b) => a.order - b.order)

/** Swatch color per belt id for the UI. */
export const beltColor: Record<string, string> = {
  white: 'white', yellow: 'yellow', orange: 'orange', green: 'green', blue: 'blue', brown: 'brown', black: 'black',
}

export const beltNames: Record<string, string> = Object.fromEntries(belts.map((b) => [b.id, b.name]))
