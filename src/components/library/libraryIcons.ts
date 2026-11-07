import {
  Baby,
  Book,
  Briefcase,
  Camera,
  Car,
  Cat,
  Dumbbell,
  Film,
  Folder,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Leaf,
  Lock,
  Moon,
  Mountain,
  Music,
  Palette,
  Plane,
  Sparkles,
  Star,
  Utensils,
  type LucideIcon,
} from "lucide-react";

/**
 * Glyphs a library can wear. Stored in `libraries.icon` as `lucide:<key>`;
 * older libraries may still hold an emoji, which keeps rendering as-is.
 */
export const LIBRARY_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  home: Home,
  heart: Heart,
  star: Star,
  camera: Camera,
  film: Film,
  music: Music,
  plane: Plane,
  mountain: Mountain,
  leaf: Leaf,
  cat: Cat,
  baby: Baby,
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
  lock: Lock,
};

const PREFIX = "lucide:";

export function iconValue(key: string): string {
  return PREFIX + key;
}

/** The glyph for a stored icon value, or null for a letter / legacy emoji. */
export function iconFor(value: string | null | undefined): LucideIcon | null {
  if (!value?.startsWith(PREFIX)) return null;
  return LIBRARY_ICONS[value.slice(PREFIX.length)] ?? null;
}
