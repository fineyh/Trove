import {
  Baby,
  Book,
  Briefcase,
  Camera,
  Car,
  Cat,
  Dog,
  Dumbbell,
  Film,
  Folder,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Image,
  Leaf,
  Lock,
  MapPin,
  Moon,
  Mountain,
  Music,
  Palette,
  Plane,
  Sparkles,
  Star,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";

/**
 * Glyphs a library can wear. Stored in `libraries.icon` as `lucide:<key>`;
 * older libraries may still hold an emoji, which keeps rendering as-is.
 * 26 of them: with the first-letter choice they fill three rows of nine.
 */
export const LIBRARY_ICONS: Record<string, LucideIcon> = {
  home: Home,
  heart: Heart,
  star: Star,
  camera: Camera,
  image: Image,
  film: Film,
  music: Music,
  plane: Plane,
  mountain: Mountain,
  pin: MapPin,
  leaf: Leaf,
  cat: Cat,
  dog: Dog,
  baby: Baby,
  users: Users,
  book: Book,
  palette: Palette,
  gamepad: Gamepad2,
  gift: Gift,
  briefcase: Briefcase,
  graduation: GraduationCap,
  car: Car,
  food: Utensils,
  sport: Dumbbell,
  moon: Moon,
  sparkles: Sparkles,
};

/**
 * No longer offered, still drawn for libraries that have them: a lock reads
 * as "locked" next to the lock badge, a folder as a synced folder (ADR-050).
 */
const RETIRED_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  lock: Lock,
};

const PREFIX = "lucide:";

export function iconValue(key: string): string {
  return PREFIX + key;
}

/** The glyph for a stored icon value, or null for a letter / legacy emoji. */
export function iconFor(value: string | null | undefined): LucideIcon | null {
  if (!value?.startsWith(PREFIX)) return null;
  const key = value.slice(PREFIX.length);
  return LIBRARY_ICONS[key] ?? RETIRED_ICONS[key] ?? null;
}
