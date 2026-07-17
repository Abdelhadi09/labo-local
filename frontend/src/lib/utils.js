import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn/Animate UI helper: merges conditional class names and
// resolves conflicting Tailwind utility classes (e.g. 'p-2 p-4' -> 'p-4').
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}