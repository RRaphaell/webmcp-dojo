// Belt roster. Order matters: belts run in this sequence.
import type { Belt } from './types'

export const belts: Belt[] = []

/** Swatch color per belt id for the UI. */
export const beltColor: Record<string, string> = {}

export const beltNames: Record<string, string> = Object.fromEntries(belts.map((b) => [b.id, b.name]))
