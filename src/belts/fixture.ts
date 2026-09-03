// The dojo's world: a small martial-arts school. Every belt reads from this
// fixture. Values that decide a pass are drawn from the run seed, so answers
// cannot be memorised, and the same seed replays the same run (evals).

export function rng(seed: number): () => number {
  // mulberry32
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'brown', 'black'] as const
export type BeltColor = (typeof BELT_ORDER)[number]

export interface Student { id: string; name: string; belt: BeltColor }
export interface DojoClass { id: string; day: string; time: string; label: string; instructor: string; roster: string[] }

const FIRST = ['Nino', 'Levan', 'Mariam', 'Giorgi', 'Ana', 'Luka', 'Tamar', 'Dato', 'Keti', 'Sandro', 'Elene', 'Nika', 'Salome', 'Irakli', 'Lika', 'Zura', 'Mira', 'Anuki', 'Tato', 'Sopo', 'Gela', 'Nana', 'Rati', 'Tekla']
const LAST = ['Beridze', 'Kapanadze', 'Gelashvili', 'Maisuradze', 'Lomidze', 'Tsiklauri', 'Japaridze', 'Kvaratskhelia', 'Abashidze', 'Mchedlishvili', 'Gogoladze', 'Chkheidze']
const INSTRUCTORS = ['Dana', 'Otar', 'Keto', 'Beka']

export interface World {
  seed: number
  students: Student[]
  classes: DojoClass[]
  /** White belt answer: the one student in both tue-spar and sat-am. */
  overlap: Student
}

export function buildWorld(seed: number): World {
  const r = rng(seed)
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)]
  const students: Student[] = []
  const used = new Set<string>()
  while (students.length < 30) {
    const name = `${pick(FIRST)} ${pick(LAST)}`
    if (used.has(name)) continue
    used.add(name)
    students.push({ id: `s-${101 + students.length}`, name, belt: pick(BELT_ORDER.slice(0, 6)) })
  }
  const shuffle = <T,>(arr: T[]) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  const ids = students.map((s) => s.id)
  const overlapId = pick(ids)
  const others = shuffle(ids.filter((i) => i !== overlapId))
  const tueSpar = [overlapId, ...others.slice(0, 8)]
  const satAm = [overlapId, ...others.slice(8, 15)]
  const classes: DojoClass[] = [
    { id: 'mon-kids', day: 'Monday', time: '16:00', label: 'kids', instructor: pick(INSTRUCTORS), roster: shuffle(others.slice(15, 25)) },
    { id: 'tue-spar', day: 'Tuesday', time: '19:00', label: 'sparring', instructor: pick(INSTRUCTORS), roster: shuffle(tueSpar) },
    { id: 'wed-forms', day: 'Wednesday', time: '18:00', label: 'forms', instructor: pick(INSTRUCTORS), roster: shuffle(others.slice(3, 12)) },
    { id: 'thu-kids', day: 'Thursday', time: '16:00', label: 'kids', instructor: 'Dana', roster: shuffle(others.slice(10, 24)) },
    { id: 'fri-kids', day: 'Friday', time: '16:00', label: 'kids', instructor: pick(INSTRUCTORS), roster: shuffle(others.slice(20, 26)) },
    { id: 'sat-am', day: 'Saturday', time: '09:00', label: 'morning open mat', instructor: pick(INSTRUCTORS), roster: shuffle(satAm) },
    { id: 'sat-adv', day: 'Saturday', time: '11:00', label: 'advanced', instructor: pick(INSTRUCTORS), roster: shuffle(others.slice(0, 6)) },
    { id: 'sun-spar', day: 'Sunday', time: '10:00', label: 'sparring', instructor: pick(INSTRUCTORS), roster: shuffle(others.slice(12, 20)) },
  ]
  return { seed, students, classes, overlap: students.find((s) => s.id === overlapId)! }
}

export function studentById(w: World, id: string): Student | undefined {
  return w.students.find((s) => s.id === id)
}

